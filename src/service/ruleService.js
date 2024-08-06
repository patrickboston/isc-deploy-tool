import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { ConnectorRuleManagementBetaApi, Paginator } from "sailpoint-api-client";
import winston from "winston";
import { runSpConfigExport, runSpConfigImport, walk, writeConfigFile } from "../util.js";

const CLOUD_RULE = "CLOUD_RULE";
const CONNECTOR_RULE = "CONNECTOR_RULE";
const CLOUD_RULE_TYPES = [
    "AttributeGenerator", "BeforeProvisioning", "AttributeGeneratorFromTemplate", "Correlation", "IdentityAttribute", "ManagerCorrelation"
];
const existingAttributeToKeep = [
    "id"
];
let ruleCache;
let connectorRuleCache;

const getAllRules = async (apiConfig) => {
    if (ruleCache) return ruleCache;

    const ruleExportConfig = {
        "excludeTypes": [
        ],
        "includeTypes": [
            "RULE"
        ],
        "objectOptions": {
        }
    }

    const rulesResponse = await runSpConfigExport(apiConfig, ruleExportConfig);
    ruleCache = rulesResponse;
    return rulesResponse;
}

const getAllConnectorRules = async (apiConfig) => {
    if (connectorRuleCache) return connectorRuleCache;

    const connectorRuleManagementBetaApi = new ConnectorRuleManagementBetaApi(apiConfig);
    const connectorRulesResponse = await Paginator.paginate(connectorRuleManagementBetaApi, connectorRuleManagementBetaApi.getConnectorRuleList, undefined, 250);

    connectorRuleCache = connectorRulesResponse.data;
    return connectorRuleCache;
}

const exportCloudRules = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Cloud Rule Export"));
    const rules = await getAllRules(apiConfig);
    for (const rule of rules) {
        //If no type (generic) or a cloud type, export it
        if (!rule.object.type || (rule.object.type && CLOUD_RULE_TYPES.includes(rule.object.type))) {
            winston.info(`Exporting Cloud Rule: ${rule.self.name} (${rule.self.id})`);
            writeConfigFile(CLOUD_RULE, rule.self.name, rule);

            //Write separate txt file with source code for easy reference
            const source = rule.object.sourceCode.script;
            const ruleSourceFileName = `./config/${CLOUD_RULE}/${rule.self.name}.source.bsh`;
            fs.writeFileSync(ruleSourceFileName, unescape(source), null, 4);
        }
    }
}

const exportConnectorRules = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Connector/VA Rule Export"));
    const currentConnectorRules = await getAllConnectorRules(apiConfig);
    for (const connectorRule of currentConnectorRules) {
        winston.info(`Exporting Connector Rule: ${connectorRule.name} (${connectorRule.id})`);
        writeConfigFile(CONNECTOR_RULE, connectorRule.name, connectorRule);

        //Write separate txt file with source code for easy reference
        const source = connectorRule.sourceCode.script;
        const ruleSourceFileName = `./config/${CONNECTOR_RULE}/${connectorRule.name}.source.bsh`;
        fs.writeFileSync(ruleSourceFileName, unescape(source), null, 4);
    }
}

const migrateCloudRules = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Cloud Rule Deployment"));

    let rulesToDeploy = [];
    const ruleFilePaths = walk(`./build/config/${CLOUD_RULE}`);

    //Iterate each rule and look it up against all fetched rules from target env
    for (const ruleFilePath of ruleFilePaths) {
        let localRule = JSON.parse(fs.readFileSync(ruleFilePath));
        rulesToDeploy.push(localRule);
    }
    if (rulesToDeploy.length > 0) {
        const spConfigImportObject = {
            objects: rulesToDeploy
        };
        const ruleImportResponse = await runSpConfigImport(apiConfig, spConfigImportObject);
        winston.debug(JSON.stringify(ruleImportResponse.data, null, 4));
        if (ruleImportResponse.data && ruleImportResponse.data.results && ruleImportResponse.data.results.RULE && ruleImportResponse.data.results.RULE.errors) {
            if (ruleImportResponse.data.results.RULE.errors.length > 0) {
                winston.error(clc.red(`Error importing cloud rules via SP-Config:\n${JSON.stringify(ruleImportResponse.data.results.RULE.errors, null, 4)}`));
            }
        }
    }
    winston.info(clc.bgGreen("Completed Cloud Rule Deployment"));
}

const migrateConnectorRule = async (apiConfig, cloudRuleJson) => {
    const connectorRuleManagementBetaApi = new ConnectorRuleManagementBetaApi(apiConfig);
    let localConnectorRule = JSON.parse(cloudRuleJson);

    //Check and see if a connector rule already exists in the target environment, no filtering need to iterate
    let currentTargetConnectorRule;
    const currentConnectorRules = await getAllConnectorRules(apiConfig);
    for (const currentConnectorRule of currentConnectorRules) {
        if (currentConnectorRule.name === localConnectorRule.name) {
            currentTargetConnectorRule = currentConnectorRule;
        }
    }

    if (!currentTargetConnectorRule) {
        winston.info(`Creating new connector rule: ${localConnectorRule.name}`);
        try {
            const createConnectorRuleResponse = await connectorRuleManagementBetaApi.createConnectorRule({
                connectorRuleCreateRequestBeta: {
                    name: localConnectorRule.name,
                    sourceCode: localConnectorRule.sourceCode,
                    type: localConnectorRule.type,
                    attributes: localConnectorRule.attributes,
                    description: localConnectorRule.description,
                    signature: localConnectorRule.signature
                }
            });
            currentTargetConnectorRule = createConnectorRuleResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(`Updating existing connector rule: ${currentTargetConnectorRule.name} (${currentTargetConnectorRule.id})`)

        //Restore attributes from the currently deployed target connector rule into our template connector rule
        for (const key of existingAttributeToKeep) {
            _.set(localConnectorRule, key, _.get(currentTargetConnectorRule, key));
        }

        //Update the connector rule with all config, references, etc.
        try {
            await connectorRuleManagementBetaApi.updateConnectorRule({
                id: localConnectorRule.id,
                connectorRuleUpdateRequestBeta: {
                    id: localConnectorRule.id,
                    name: localConnectorRule.name,
                    sourceCode: localConnectorRule.sourceCode,
                    type: localConnectorRule.type,
                    attributes: localConnectorRule.attributes,
                    description: localConnectorRule.description,
                    signature: localConnectorRule.signature
                }
            });
        } catch (error) {
            await handleHttpException(error);
        }
    }
}

const migrateConnectorRules = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Connector/VA Rule Deployment"));
    const connectorRuleFilePaths = walk("./build/config/CONNECTOR_RULE");

    //Iterate each connector rule and pass it to migrateconnector rule
    for (const connectorRuleFilePath of connectorRuleFilePaths) {
        const connectorRule = fs.readFileSync(connectorRuleFilePath);
        await migrateConnectorRule(apiConfig, connectorRule);
    }
    winston.info(clc.bgGreen("Completed Connector/VA Rule Deployment"));
}

export {
    exportConnectorRules, exportCloudRules, getAllRules, migrateCloudRules, migrateConnectorRules
};

