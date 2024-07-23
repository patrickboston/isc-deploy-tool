import clc from "cli-color";
import * as fs from "fs";
import winston from "winston";
import { runSpConfigImport, writeConfigFile } from "../util.js";
import { runSpConfigExport, walk } from "../util.js";

const RULE = "RULE";
let ruleCache;

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

const exportRules = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Rule Export"));
    const rules = await getAllRules(apiConfig);
    for (const rule of rules) {
        winston.info(`Exporting Rule: ${rule.self.name} (${rule.self.id})`);
        writeConfigFile(RULE, rule.self.name, rule);

        //Write separate txt file with source code for easy reference
        const source = rule.object.sourceCode.script;
        const ruleSourceFileName = `./config/RULE/${rule.self.name}.source.txt`;
        fs.writeFileSync(ruleSourceFileName, unescape(source), null, 4);
    }
}

const migrateRules = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Rule Deployment"));

    let rulesToDeploy = [];
    const targetRules = await getAllRules(apiConfig);
    const ruleFilePaths = walk("./build/config/RULE");

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
                winston.error(clc.red(`Error import rules via SP-Config:\n${JSON.stringify(ruleImportResponse.data.results.RULE.errors, null, 4)}`));
            }
        }
    }
    winston.info(clc.bgGreen("Completed Rule Deployment"));
}

export {
    exportRules, getAllRules, migrateRules
};

