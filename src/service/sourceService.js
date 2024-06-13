import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { Paginator, SourcesApi, SourcesBetaApi } from "sailpoint-api-client";
import { walk, writeConfigFile, handleHttpException } from "../util.js";
import { getAllClusters } from "./clusterUtil.js";
import { getIdentityByAlias, getIdentityById } from "./identityUtil.js";
import { getAllRules } from "./ruleUtil.js";

const CONNECTOR_SCHEMA = "CONNECTOR_SCHEMA";
const PROVISIONING_POLICY = "PROVISIONING_POLICY";
const ATTR_SYNC_SOURCE_CONFIG = "ATTR_SYNC_SOURCE_CONFIG";
const existingAttributeToKeep = [
    "id", "authoritative", "connectorAttributes.cloudExternalId", "passwordPolicies", "connectorAttributes.healthy", "healthy"
];
const ruleReferenceNames = [
    "accountCorrelationRule", "managerCorrelationRule", "beforeProvisioningRule"
];

const getSourceByName = async (apiConfig, sourceName) => {
    const sourcesApi = new SourcesApi(apiConfig);
    const currentSourceResponse = await sourcesApi.listSources({
        filters: `name eq "${sourceName}"`,
        limit: 1
    });

    const currentTartgetSource = currentSourceResponse.data.length == 1 ? currentSourceResponse.data[0] : null;

    if (!currentTartgetSource) throw new Error(`Could not find source by name [${sourceName}] in tenant: ${apiConfig.basePath}`);
    return currentTartgetSource;
}

const getSourceById = async (apiConfig, sourceId) => {
    const sourcesApi = new SourcesApi(apiConfig);
    const currentSourceResponse = await sourcesApi.listSources({
        filters: `id eq "${sourceId}"`,
        limit: 1
    });

    const currentTartgetSource = currentSourceResponse.data.length == 1 ? currentSourceResponse.data[0] : null;

    //If the source does not exist, we need to create at least a shell source so schemas, etc. can reference it
    if (!currentTartgetSource) throw new Error(`Could not find source by id [${sourceId}] in tenant: ${apiConfig.basePath}`);
    return currentTartgetSource;
}

/**
* Gets all sources via v3/sources and write appropriate 
* Source files and referenced objects
* @param {Configuration} apiConfig
*/
const exportSources = async (apiConfig) => {
    console.info(clc.bgBlueBright("Performing Source export"));
    const sourcesApi = new SourcesApi(apiConfig);

    const sources = await Paginator.paginate(sourcesApi, sourcesApi.listSources, { limit: 1000 }, 250);
    for (const source of sources.data) {
        //Clone for modifications
        let sourceClone = structuredClone(source);

        const sourceName = source.name;
        console.log(clc.bgCyan(`Processing export for source: ${sourceName}`));

        //Get and write referenced schemas on source
        const sourceSchemas = await sourcesApi.listSourceSchemas({ sourceId: source.id });
        for (const schema of sourceSchemas.data) {
            writeConfigFile(CONNECTOR_SCHEMA, schema.name, schema, `SOURCE/${sourceName}/CONNECTOR_SCHEMA`);
        }

        //Get and write referenced policies on source
        const sourcePolicies = await sourcesApi.listProvisioningPolicies({ sourceId: source.id });
        for (const policy of sourcePolicies.data) {
            const policyFileName = policy.name + "_" + policy.usageType;
            writeConfigFile(PROVISIONING_POLICY, policyFileName, policy, `SOURCE/${sourceName}/PROVISIONING_POLICY`);
        }

        //Attribute Sync Config
        const betaSourcesApi = new SourcesBetaApi(apiConfig);
        const attrSyncConfigResponse = await betaSourcesApi.getSourceAttrSyncConfig({ id: source.id });
        if (attrSyncConfigResponse.data) {
            const attrSyncFileName = sourceName + "_ATTR_SYNC";
            writeConfigFile(ATTR_SYNC_SOURCE_CONFIG, attrSyncFileName, attrSyncConfigResponse.data, `SOURCE/${sourceName}/${ATTR_SYNC_SOURCE_CONFIG}`);
        }

        //Update source owner to alias for lookup when migrating
        //TODO: Cache owners as we iterate so we don't hit up the API every time
        const owner = await getIdentityById(apiConfig, source.owner.id);
        sourceClone.owner.name = owner.alias;

        //Write the actual source
        writeConfigFile("SOURCE", sourceName, sourceClone, `SOURCE/${sourceName}`);
    }
};

const migrateSource = async (apiConfig, sourceJson) => {
    const sourcesApi = new SourcesApi(apiConfig);
    let localSource = JSON.parse(sourceJson);
    console.log(clc.bgBlueBright(`Migrating source: ${localSource.name}`));

    //Get corresponding cluster by name and add id
    if (localSource.cluster) {
        const clusters = await getAllClusters(apiConfig);
        for (const cluster of clusters) {
            if (localSource.cluster.name === cluster.name) {
                _.set(localSource, "cluster.id", cluster.id)
            }
        }
    }

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(apiConfig, _.get(localSource, "owner.name"));
    _.set(localSource, "owner.id", owner.id);

    //Check and see if a source with this name already exists in the target environment
    const currentSourceResponse = await sourcesApi.listSources({
        filters: `name eq "${localSource.name}"`,
        limit: 1
    });

    let currentTartgetSource = currentSourceResponse.data.length == 1 ? currentSourceResponse.data[0] : null;

    //If the source does not exist, we need to create at least a shell source so schemas, etc. can reference it
    if (!currentTartgetSource) {
        console.log(`Creating new source for: ${localSource.name}`);
        const csvSource = localSource.type === "Delimited File";
        try {
            const createSourceResponse = await sourcesApi.createSource({
                source: localSource,
                provisionAsCsv: csvSource
            });

            currentTartgetSource = createSourceResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        console.log(`Found existing source in target environment: ${currentTartgetSource.name} (${currentTartgetSource.id})`)
    }

    //Correlation Config needs to be updated from target source if exists
    if (localSource.accountCorrelationConfig && currentTartgetSource.accountCorrelationConfig) {
        localSource.accountCorrelationConfig = currentTartgetSource.accountCorrelationConfig;
    } else {
        //If current source does not have correlation config set, null out on local
        _.unset(localSource, "accountCorrelationConfig");
    }

    //TODO: Create correlation config once public API is available, uses /diana endpoint today

    //Attribute sync config
    const betaSourcesApi = new SourcesBetaApi(apiConfig);
    const localAttrSyncFiles = walk(`./build/config/SOURCE/${localSource.name}/${ATTR_SYNC_SOURCE_CONFIG}`);
    for (const localAttrSyncFile of localAttrSyncFiles) {
        let attrSyncCopy = JSON.parse(fs.readFileSync(localAttrSyncFile, { encoding: "utf8" }));
        _.set(attrSyncCopy, "source.name", currentTartgetSource.id);

        //Only attempt to deploy it if it has "attributes" (things checked off) or else it will fail 
        if (attrSyncCopy.attributes && attrSyncCopy.attributes.length > 0) {
            try {
                await betaSourcesApi.putSourceAttrSyncConfig({
                    id: currentTartgetSource.id,
                    attrSyncSourceConfigBeta: attrSyncCopy
                });
            } catch (error) {
                await handleHttpException(error);
            }
        }
    }

    //Update all rule references
    const rules = await getAllRules(apiConfig);

    for (const ruleReferenceName of ruleReferenceNames) {
        if (_.get(localSource, ruleReferenceName)) {
            let ruleRef = _.get(localSource, ruleReferenceName);
            console.log(ruleRef);

            for (const rule of rules) {
                if (rule.self.name === ruleRef.name) {
                    ruleRef.id = rule.self.id;

                    console.log(ruleRef);
                    _.set(localSource, ruleReferenceName, ruleRef);
                }
            }
        }
    }

    //Create/Update all Provisioning Policies
    const localPolicyFiles = walk(`./build/config/SOURCE/${localSource.name}/PROVISIONING_POLICY`);
    for (const localPolicyFile of localPolicyFiles) {
        let policyCopy = JSON.parse(fs.readFileSync(localPolicyFile, { encoding: "utf8" }));
        let createPolicy = true;

        //Get all policies from current target source
        let currentTargetPolicyResponse;
        currentTargetPolicyResponse = await sourcesApi.listProvisioningPolicies({
            sourceId: currentTartgetSource.id,
        });

        if (currentTargetPolicyResponse) {
            for (const currentPolicy of currentTargetPolicyResponse.data) {
                //Need to compare the names tlll we find a match
                if (currentPolicy.name === policyCopy.name && currentPolicy.usageType === policyCopy.usageType) {
                    //Update policy itself
                    try {
                        await sourcesApi.putProvisioningPolicy({
                            sourceId: currentTartgetSource.id,
                            usageType: currentPolicy.usageType,
                            provisioningPolicyDto: policyCopy
                        });
                    } catch (error) {
                        await handleHttpException(error);
                    }

                    //Schema exists already in target, set flag
                    createPolicy = false;
                    break;
                }
            }
        }

        //Only create if it wasn't found in the target
        if (createPolicy) {
            try {
                await sourcesApi.createProvisioningPolicy({
                    sourceId: currentTartgetSource.id,
                    provisioningPolicyDto: policyCopy
                });
            } catch (error) {
                await handleHttpException(error);
            }
        }
    }

    /*
     * Get all local schema templates and iterate them, check and see if there is a matching current
     * schema in the deployed target source. If found, update it with a PUT, if not found, create a new
     * schema. Also need to update the schema reference ID in the source itself as we update the referenced
     * schema object
    */
    const localSchemaFiles = walk(`./build/config/SOURCE/${localSource.name}/CONNECTOR_SCHEMA`);
    for (const localSchemaFile of localSchemaFiles) {
        let schemaCopy = JSON.parse(fs.readFileSync(localSchemaFile, { encoding: "utf8" }));
        let createSchema = true;

        //Get all schemas from current target source, no way to filter on specific schemas by type/name
        let currentTargetSchemaResponse;
        currentTargetSchemaResponse = await sourcesApi.listSourceSchemas({
            sourceId: currentTartgetSource.id,
        });

        if (currentTargetSchemaResponse) {
            for (const currentSchema of currentTargetSchemaResponse.data) {
                //Need to compare the names tlll we find a match
                if (currentSchema.name === schemaCopy.name) {
                    //Update schema itself
                    schemaCopy.id = currentSchema.id;
                    try {
                        await sourcesApi.putSourceSchema({
                            schema: schemaCopy,
                            schemaId: currentSchema.id,
                            sourceId: currentTartgetSource.id
                        });

                        //Update schema reference on source
                        for (let schemaReference of localSource.schemas) {
                            if (schemaReference.name === schemaCopy.name) {
                                schemaReference.id = currentSchema.id;
                            }
                        }
                    } catch (error) {
                        await handleHttpException(error);
                    }

                    //Schema exists already in target, set flag
                    createSchema = false;
                    break;
                }
            }
        }

        //Only create if it wasn't found in the target
        if (createSchema) {
            console.log(`Schema being created for source ${localSource.name}`)
            try {
                const createSchemaResponse = await sourcesApi.createSourceSchema({
                    schema: schemaCopy,
                    sourceId: currentTartgetSource.id
                });

                //Add schema reference on source for new schema
                const schemaRef = {
                    type: CONNECTOR_SCHEMA,
                    name: schemaCopy.name,
                    id: createSchemaResponse.data.id
                };

                let currentSchemas = localSource.schemas;
                currentSchemas.push(schemaRef);
                localSource.schemas = currentSchemas;
            } catch (error) {
                await handleHttpException(error);
            }
        }
    }

    //Restore attributes from the currently deployed target source into our template source
    for (const sourceKey of existingAttributeToKeep) {
        _.set(localSource, sourceKey, _.get(currentTartgetSource, sourceKey));
    }

    //Update the source with all config, references, etc.
    console.log(`Source JSON to be deployed:\n ${JSON.stringify(localSource, null, 4)}`);
    try {
        await sourcesApi.putSource({
            id: localSource.id,
            source: localSource
        });
    } catch (error) {
        await handleHttpException(error);
    }
}

export {
    exportSources, getSourceById, getSourceByName, migrateSource
};

