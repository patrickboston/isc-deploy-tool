import clc from "cli-color";
import * as fs from "fs";
import axios from "axios";
import _ from "lodash";
import {
    Configuration,
    ConnectorsBetaApi,
    Paginator,
    SourcesApi,
    SourcesBetaApi,
    SourcesV2025Api,
    MachineClassificationConfigV2025Api,
    MachineAccountMappingsV2025Api
} from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, sleep, walk, writeConfigFile } from "../util.js";
import { getAllClusters } from "./clusterService.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";
import { getAllRules } from "./ruleService.js";
import { getAllPasswordPolicies } from "./passwordPolicyService.js";
import path from "path";
import FormData from "form-data";

const CONNECTOR_SCHEMA = "CONNECTOR_SCHEMA";
const PROVISIONING_POLICY = "PROVISIONING_POLICY";
const ATTR_SYNC_SOURCE_CONFIG = "ATTR_SYNC_SOURCE_CONFIG";
const NATIVE_CHANGE_DETECTION = "NATIVE_CHANGE_DETECTION";
const MACHINE_CLASSIFICATION = "MACHINE_CLASSIFICATION";
const MACHINE_MAPPING = "MACHINE_MAPPING";
const CORRELATION_CONFIG = "CORRELATION_CONFIG";
const AGGREGATION_SCHEDULE = "AGGREGATION_SCHEDULE";
const existingAttributeToKeep = [
    "id",
    "authoritative",
    "connectorAttributes.cloudExternalId",
    "passwordPolicies",
    "connectorAttributes.healthy",
    "healthy",
    "connectorAttributes.slpt-source-diagnostics",
    //These are were added for custom SaaS connector deployment support
    "type",
    "connector",
    "connectorId",
    "connectorImplementationId",
    "connectorAttributes.spConnectorSpecId",
    "connectorAttributes.spConnectorInstanceId",
    "connectorAttributes.spConnectorInstanceName",
    "connectorAttributes.status",
    "status"
];
const ruleReferenceNames = [
    "accountCorrelationRule",
    "managerCorrelationRule",
    "beforeProvisioningRule",
];
let sourceCache = {};

const getSourceByName = async (apiConfig, sourceName) => {
    if (sourceCache[sourceName]) return sourceCache[sourceName];

    const sourcesApi = new SourcesApi(apiConfig);
    const currentSourceResponse = await sourcesApi
        .listSources({
            filters: `name eq "${sourceName}"`,
            limit: 1,
        })
        .catch((error) => {
            handleHttpException(error);
        });

    const currentTargetSource =
        currentSourceResponse.data.length == 1
            ? currentSourceResponse.data[0]
            : null;

    if (!currentTargetSource)
        throw new Error(
            `Could not find source by name [${sourceName}] in tenant: ${apiConfig.basePath}`
        );
    return currentTargetSource;
};

const getSourceById = async (apiConfig, sourceId) => {
    if (sourceCache[sourceId]) return sourceCache[sourceId];

    const sourcesApi = new SourcesApi(apiConfig);
    const currentSourceResponse = await sourcesApi
        .listSources({
            filters: `id eq "${sourceId}"`,
            limit: 1,
        })
        .catch((error) => {
            handleHttpException(error);
        });

    const currentTargetSource =
        currentSourceResponse.data.length == 1
            ? currentSourceResponse.data[0]
            : null;

    //If the source does not exist, we need to create at least a shell source so schemas, etc. can reference it
    if (!currentTargetSource)
        throw new Error(
            `Could not find source by id [${sourceId}] in tenant: ${apiConfig.basePath}`
        );
    return currentTargetSource;
};

/**
 * Gets all sources via v3/sources and write appropriate
 * Source files and referenced objects
 * @param {Configuration} apiConfig
 */
const exportSources = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Source Export"));
    const sourcesApi = new SourcesApi(apiConfig);
    const sourcesApiBeta = new SourcesBetaApi(apiConfig);
    const sourcesV2025Api = new SourcesV2025Api(apiConfig);
    const machineClassificationApi = new MachineClassificationConfigV2025Api(apiConfig);
    const machineMappingApi = new MachineAccountMappingsV2025Api(apiConfig);

    const sources = await Paginator.paginate(
        sourcesApi,
        sourcesApi.listSources,
        undefined,
        250
    ).catch((error) => {
        handleHttpException(error);
    });
    for (const source of sources.data) {
        //Clone for modifications
        let sourceClone = structuredClone(source);
        const sourceName = source.name;
        winston.info(`Exporting Source: ${source.name} (${source.id})`);

        //Get and write referenced correlation config on source (non-sdk at the moment)
        const sourceCorrelationConfigResponse =
            await sourcesApiBeta.getCorrelationConfig({
                sourceId: source.id,
            });

        const sourceCorrelationConfig = sourceCorrelationConfigResponse.data;
        if (sourceCorrelationConfig && sourceCorrelationConfig.name) {
            winston.info(
                `Exporting correlation config for source: ${sourceName}`
            );
            writeConfigFile(
                CORRELATION_CONFIG,
                sourceCorrelationConfig.name,
                sourceCorrelationConfig,
                `SOURCE/${sourceName}/CORRELATION_CONFIG`
            );
        }

        //Get and write referenced schemas on source
        const sourceSchemas = await sourcesApi
            .getSourceSchemas({ sourceId: source.id })
            .catch((error) => {
                handleHttpException(error);
            });
        for (const schema of sourceSchemas.data) {
            winston.info(
                `Exporting schema for source: ${sourceName} - ${schema.name}`
            );
            writeConfigFile(
                CONNECTOR_SCHEMA,
                schema.name,
                schema,
                `SOURCE/${sourceName}/CONNECTOR_SCHEMA`
            );
        }

        //Get and write referenced policies on source
        const sourcePolicies = await sourcesApi
            .listProvisioningPolicies({ sourceId: source.id })
            .catch((error) => {
                handleHttpException(error);
            });
        for (const policy of sourcePolicies.data) {
            const policyFileName = policy.name + "_" + policy.usageType;
            winston.info(
                `Exporting policy for source: ${sourceName} - ${policy.name} (${policy.usageType})`
            );
            writeConfigFile(
                PROVISIONING_POLICY,
                policyFileName,
                policy,
                `SOURCE/${sourceName}/PROVISIONING_POLICY`
            );
        }

        //Attribute Sync Config
        const attrSyncConfigResponse =
            await sourcesApiBeta.getSourceAttrSyncConfig({ id: source.id });
        if (attrSyncConfigResponse.data) {
            winston.info(
                `Exporting attribute sync config for source: ${sourceName}`
            );
            const attrSyncFileName = sourceName + "_ATTR_SYNC";
            writeConfigFile(
                ATTR_SYNC_SOURCE_CONFIG,
                attrSyncFileName,
                attrSyncConfigResponse.data,
                `SOURCE/${sourceName}/${ATTR_SYNC_SOURCE_CONFIG}`
            );
        }

        //Native Change Config
        const nativeChangeConfigResponse = await sourcesApiBeta.getNativeChangeDetectionConfig({ sourceId: source.id });
        if (nativeChangeConfigResponse.data) {
            winston.info(`Exporting native change detection config for source: ${sourceName}`);
            const nativeChangeFileName = `${sourceName}_${NATIVE_CHANGE_DETECTION}`;
            writeConfigFile(NATIVE_CHANGE_DETECTION, nativeChangeFileName, nativeChangeConfigResponse.data, `SOURCE/${sourceName}/${NATIVE_CHANGE_DETECTION}`);
        }

        //Aggregation Schedule
        const sourceSchedules = await sourcesV2025Api
            .getSourceSchedules({ sourceId: source.id })
            .catch((error) => {
                handleHttpException(error);
            });
        for (const schedule of sourceSchedules.data) {
            winston.info(
                `Exporting schedule for source: ${sourceName} - ${schedule.type}`
            );
            writeConfigFile(
                AGGREGATION_SCHEDULE,
                schedule.type,
                schedule,
                `SOURCE/${sourceName}/${AGGREGATION_SCHEDULE}`
            );
        }

        //Machine classification config
        //Bug in sdk, have to do this manually. machineClassificationApi.getMachineClassificationConfig({ id: source.id });
        try {
            const machineClassificationConfigResponse = await axios.request({
                method: "get",
                url: `${apiConfig.basePath}/v2025/sources/${source.id}/machine-classification-config`,
                headers: {
                    Authorization: `Bearer ${await apiConfig.accessToken}`,
                    "X-SailPoint-Experimental": "true"
                }
            });

            if (machineClassificationConfigResponse.data) {
                winston.info(`Exporting machine classification config for source: ${sourceName}`);
                const machineClassificationFileName = sourceName + "_MACHINE_CLASSIFICATION";
                writeConfigFile(MACHINE_CLASSIFICATION, machineClassificationFileName, machineClassificationConfigResponse.data, `SOURCE/${sourceName}/${MACHINE_CLASSIFICATION}`);
            }
        } catch (error) {
            await handleHttpException(error);
        }


        //Machine mapping config
        try {
            const machineMappingConfigResponse = await axios.request({
                method: "get",
                url: `${apiConfig.basePath}/v2025/sources/${source.id}/machine-account-mappings`,
                headers: {
                    Authorization: `Bearer ${await apiConfig.accessToken}`,
                    "X-SailPoint-Experimental": "true"
                }
            });

            if (machineMappingConfigResponse.data && machineMappingConfigResponse.data.length > 0) {
                winston.info(`Exporting machine mapping config for source: ${sourceName}`);
                const machineMappingFileName = sourceName + "_MACHINE_MAPPING";
                writeConfigFile(MACHINE_MAPPING, machineMappingFileName, machineMappingConfigResponse.data, `SOURCE/${sourceName}/${MACHINE_MAPPING}`);
            }
        } catch (error) {
            await handleHttpException(error);
        }

        //Update source owner to alias for lookup when migrating
        const owner = await getIdentityById(apiConfig, source.owner.id);
        sourceClone.owner.name = owner.alias;

        //Sort features alphabetically since the API outputs them in a different order every time
        if (sourceClone.features) sourceClone.features.sort();

        //Write the actual source
        writeConfigFile(
            "SOURCE",
            sourceName,
            sourceClone,
            `SOURCE/${sourceName}`
        );
    }
};

/**
 * Creates or updates a source in the target tenant
 * @param {Configuration} apiConfig  SailPoint API Config
 * @param {string} sourceJson        Raw JSON String of source to be deployed
 */
const migrateSource = async (apiConfig, sourceJson, skipConnectorLib) => {
    const sourcesApi = new SourcesApi(apiConfig);
    const betaSourcesApi = new SourcesBetaApi(apiConfig);
    const connectorsApi = new ConnectorsBetaApi(apiConfig);
    const sourcesV2025Api = new SourcesV2025Api(apiConfig);

    let localSource = JSON.parse(sourceJson);
    let saasSourceConnectorAttributesCopy;
    let saasClusterCopy;

    //Get corresponding cluster by name and add id
    let isSaaS = false;
    if (localSource.cluster) {
        if (localSource.cluster.name === "sp_connect_proxy_cluster") {
            isSaaS = true;
            saasSourceConnectorAttributesCopy = localSource.connectorAttributes;
            saasClusterCopy = localSource.cluster;
        }

        //We only need this lookup if not SaaS
        if (!isSaaS) {
            const clusters = await getAllClusters(apiConfig);
            for (const cluster of clusters) {
                if (localSource.cluster.name === cluster.name) {
                    _.set(localSource, "cluster.id", cluster.id);
                }
            }
        }
    }

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(
        apiConfig,
        _.get(localSource, "owner.name")
    );
    _.set(localSource, "owner.id", owner.id);

    //Check and see if a source with this name already exists in the target environment
    const currentSourceResponse = await sourcesApi
        .listSources({
            filters: `name eq "${localSource.name}"`,
            limit: 1,
        })
        .catch((error) => {
            handleHttpException(error);
        });

    let currentTargetSource =
        currentSourceResponse.data.length == 1
            ? currentSourceResponse.data[0]
            : null;

    //If the source does not exist, we need to create at least a shell source so schemas, etc. can reference it
    if (!currentTargetSource) {
        const csvSource = localSource.type === "DelimitedFile";

        //Remove accountCorrelationConfig on create since we have no way of finding the reference
        _.unset(localSource, "accountCorrelationConfig");
        if (localSource.schemas) {
            _.unset(localSource, "schemas");
        }
        if (localSource.passwordPolicies) {
            _.unset(localSource, "passwordPolicies");
        }

        //Update all rule references
        const rules = await getAllRules(apiConfig);

        for (const ruleReferenceName of ruleReferenceNames) {
            if (_.get(localSource, ruleReferenceName)) {
                let ruleRef = _.get(localSource, ruleReferenceName);

                for (const rule of rules) {
                    if (rule.self.name === ruleRef.name) {
                        ruleRef.id = rule.self.id;
                        _.set(localSource, ruleReferenceName, ruleRef);
                    }
                }
            }
        }

        /*
         * If this is a SaaS type source, we need to remove the cluster since we cannot
         * look up the id of it since the cluster is some backend proxy cluster for SaaS connectors
         *
         * We also need to remove the connectorAttributes. If you include them, you get back some generic
         * 500 internal fault, without them, it works. Perhaps some kind of lookup for the connectorImplementationId.
         * They will get added back after the update happens later on in this method
         */
        if (isSaaS) {
            if (localSource.cluster) _.unset(localSource, "cluster");
            if (localSource.connectorAttributes)
                _.unset(localSource, "connectorAttributes");

            /* When deploying a custom SaaS source, follow these rules:
            * New source is deployed with attribute "connector" like so: connector: "7a74eb93-bff6-4c70-80c1-9d800ac793cd" 
            * the value is the 'type' in the connector entry via the GET /beta/connectors endpoint
            * All the other attributes related to the connector then reference the same value (i.e. connectorId, connectorImplementationId, etc.)
            * These are not omitted on export, but are  retained on import if source exists already
            * 
            * 
            * Here is the payload required for create:
            *  {
                    "name": "asaas",
                    "description": "asaas",
                    "connector": "7a74eb93-bff6-4c70-80c1-9d800ac793cd",
                    "owner": {
                        "id": "87b682d779e2419cb1875b759b7fc2af",
                        "name": "pboston.pboston",
                        "type": "IDENTITY"
                    }
                }
            * 
            * spConnectorInstanceId is the only attribute that is not the connector id from above, so that will be omitted on export
            * and retained during import as well.
            */

            /*
             * If this is SaaS, we need to check and see if it is a custom connector by checking
             * the connector id, if it is a guid and not a friendly name like 'oktasaas', we assume custom
             * I can't find a better indicator at the moment. This only needs to happen on create, if it
             * already exists we will just retain the current values for custom saas connectors
             */
            const customConnectorIdRegex =
                /^[a-zA-Z0-9]{8}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{12}$/;
            if (customConnectorIdRegex.test(localSource.connector)) {
                const connectorResponse = await connectorsApi.getConnectorList({
                    limit: 1,
                    filters: `name sw "${localSource.connectorName}"`, //Endpoint only supports sw, not eq
                });
                if (connectorResponse.data.length === 1) {
                    const connectorTypeId = connectorResponse.data[0].type;
                    _.set(localSource, "connector", connectorTypeId);
                } else if (connectorResponse.data.length === 0) {
                    winston.error(
                        `Could not find connector type via GET /beta/connectors for custom SaaS source type [${connectorName}]`
                    );
                    process.exit(1);
                }
            }
        }

        winston.info(`Creating new source: ${localSource.name}`);
        winston.debug(JSON.stringify(localSource, null, 4));

        try {
            const createSourceResponse = await sourcesApi.createSource({
                source: localSource,
                provisionAsCsv: csvSource,
            });

            currentTargetSource = createSourceResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(
            `Updating existing source: ${currentTargetSource.name} (${currentTargetSource.id})`
        );
    }

    //A source needs to exist to perform all the updates properly
    if (currentTargetSource) {
        if (isSaaS && saasSourceConnectorAttributesCopy) {
            //Restore connectorAttributes we removed during initial create
            localSource.connectorAttributes = saasSourceConnectorAttributesCopy;
            localSource.cluster = saasClusterCopy;
        }

        /*
         * If this is a SaaS source, we need to inject the id of the proxy cluster that is currently set
         * on the source since we cannot fetch it before hand, there is no endpoint to get this private
         * backend cluster
         */
        if (isSaaS && currentTargetSource.cluster) {
            _.set(localSource, "cluster.id", currentTargetSource.cluster.id);
        }

        //Correlation Config needs to be updated from target source if exists
        const localCorrelationConfigFiles = walk(
            `./build/config/SOURCE/${localSource.name}/${CORRELATION_CONFIG}`
        );
        for (const localCorrelationConfigFile of localCorrelationConfigFiles) {
            let correlationConfigCopy = JSON.parse(
                fs.readFileSync(localCorrelationConfigFile, {
                    encoding: "utf8",
                })
            );

            winston.info(`Updating source correlation configuration`);
            try {
                const sourceCorrelationConfigResponse =
                    await betaSourcesApi.putCorrelationConfig({
                        sourceId: currentTargetSource.id,
                        correlationConfigBeta: correlationConfigCopy,
                    });

                sleep(1000);

                const sourceCorrelationConfig =
                    sourceCorrelationConfigResponse.data;
                _.set(
                    localSource,
                    "accountCorrelationConfig.id",
                    sourceCorrelationConfig.id
                );
                //localSource.accountCorrelationConfig.id = sourceCorrelationConfig.id;
            } catch (error) {
                handleHttpException(error);

                //Make sure we still update the correlation reference if there was a failure or else the source will fail to update
                if (currentTargetSource.accountCorrelationConfig) {
                    localSource.accountCorrelationConfig.id =
                        currentTargetSource.accountCorrelationConfig.id;
                }
            }
        }

        //Password Policy References - we can't filter by name in API so need to iterate each and check
        /* This doesn't actually work for whatever reason, if you attach a policy in the UI, it uses
        PATCH /beta/sources/:id/password-policies which is not a documented endpoint so there is no
        function for it in the SDK right now, so leaving it out until that becomes available
        if (localSource.passwordPolicies) {
            const currentTargetPasswordPolicies = await getAllPasswordPolicies(apiConfig);
            if (currentTargetPasswordPolicies) {
                for (let localSourcePolicy of localSource.passwordPolicies) {
                    for (const currentTargetPasswordPolicy of currentTargetPasswordPolicies) {
                        if (currentTargetPasswordPolicy.name === localSourcePolicy.name) {
                            localSourcePolicy.id = currentTargetPasswordPolicy.id;
                        }
                    }
                }
            }
        }
        */

        //Update all rule references
        const rules = await getAllRules(apiConfig);

        for (const ruleReferenceName of ruleReferenceNames) {
            if (_.get(localSource, ruleReferenceName)) {
                let ruleRef = _.get(localSource, ruleReferenceName);

                for (const rule of rules) {
                    if (rule.self.name === ruleRef.name) {
                        ruleRef.id = rule.self.id;
                        _.set(localSource, ruleReferenceName, ruleRef);
                    }
                }
            }
        }

        /*
         * Get all local schema templates and iterate them, check and see if there is a matching current
         * schema in the deployed target source. If found, update it with a PUT, if not found, create a new
         * schema. Also need to update the schema reference ID in the source itself as we update the referenced
         * schema object
         */
        const localSchemaFiles = walk(
            `./build/config/SOURCE/${localSource.name}/CONNECTOR_SCHEMA`
        );
        if (localSchemaFiles) {
            let schemaFilesToProcessLater = [];

            // Get all schemas from current target source
            let currentTargetSchemasResponse = await sourcesApi
                .getSourceSchemas({
                    sourceId: currentTargetSource.id,
                })
                .catch((error) => {
                    handleHttpException(error);
                });

            let schemaReferences = {};
            if (currentTargetSchemasResponse.data) {
                for (const currentSchema of currentTargetSchemasResponse.data) {
                    schemaReferences[currentSchema.name] = currentSchema;
                }
            }

            // First pass: Process schemas without references
            for (const localSchemaFile of localSchemaFiles) {
                let schemaCopy = JSON.parse(
                    fs.readFileSync(localSchemaFile, { encoding: "utf8" })
                );
                if (
                    schemaCopy.attributes &&
                    schemaCopy.attributes.some((attr) => attr.schema)
                ) {
                    schemaFilesToProcessLater.push(localSchemaFile);
                } else {
                    const res = await processSchema(
                        sourcesApi,
                        localSource,
                        currentTargetSource,
                        localSchemaFile,
                        schemaReferences
                    );
                    //If there was a schema created, it will return it here to update schema refs
                    if (res) {
                        schemaReferences[res.name] = res;
                    }
                }
            }

            // Second pass: Process schemas with references
            for (const localSchemaFile of schemaFilesToProcessLater) {
                const res = await processSchema(
                    sourcesApi,
                    localSource,
                    currentTargetSource,
                    localSchemaFile,
                    schemaReferences
                );
                //If there was a schema created, it will return it here to update schema refs
                if (res) {
                    schemaReferences[res.name] = res;
                }
            }
        }

        //Create/Update all Provisioning Policies
        const localPolicyFiles = walk(
            `./build/config/SOURCE/${localSource.name}/PROVISIONING_POLICY`
        );
        for (const localPolicyFile of localPolicyFiles) {
            let policyCopy = JSON.parse(
                fs.readFileSync(localPolicyFile, { encoding: "utf8" })
            );
            let createPolicy = true;

            //Get all policies from current target source
            let currentTargetPolicyResponse;
            currentTargetPolicyResponse = await sourcesApi
                .listProvisioningPolicies({
                    sourceId: currentTargetSource.id,
                })
                .catch((error) => {
                    handleHttpException(error);
                });

            if (currentTargetPolicyResponse) {
                for (const currentPolicy of currentTargetPolicyResponse.data) {
                    //Need to compare the names till we find a match
                    if (
                        currentPolicy.name === policyCopy.name &&
                        currentPolicy.usageType === policyCopy.usageType
                    ) {
                        //Update policy itself
                        winston.info(
                            `Updating existing source provisioning policy: ${localSource.name} - ${policyCopy.name}`
                        );
                        try {
                            await sourcesApi.putProvisioningPolicy({
                                sourceId: currentTargetSource.id,
                                usageType: currentPolicy.usageType,
                                provisioningPolicyDto: policyCopy,
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
                winston.info(
                    `Creating new source provisioning policy: ${localSource.name} - ${policyCopy.name}`
                );
                try {
                    await sourcesApi.createProvisioningPolicy({
                        sourceId: currentTargetSource.id,
                        provisioningPolicyDto: policyCopy,
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            }
        }

        //Attribute sync config
        const localAttrSyncFiles = walk(
            `./build/config/SOURCE/${localSource.name}/${ATTR_SYNC_SOURCE_CONFIG}`
        );
        for (const localAttrSyncFile of localAttrSyncFiles) {
            let attrSyncCopy = JSON.parse(
                fs.readFileSync(localAttrSyncFile, { encoding: "utf8" })
            );
            _.set(attrSyncCopy, "source.id", currentTargetSource.id);

            //Only attempt to deploy it if it has "attributes" (things checked off) or else it will fail
            if (attrSyncCopy.attributes && attrSyncCopy.attributes.length > 0) {
                try {
                    winston.info(`Updating source attribute sync config`);
                    await betaSourcesApi.putSourceAttrSyncConfig({
                        id: currentTargetSource.id,
                        attrSyncSourceConfigBeta: attrSyncCopy,
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            }
        }

        //Native change detection config
        const localNativeChangeFiles = walk(`./build/config/SOURCE/${localSource.name}/${NATIVE_CHANGE_DETECTION}`);
        for (const localNativeChangeFile of localNativeChangeFiles) {
            let nativeChangeCopy = JSON.parse(fs.readFileSync(localNativeChangeFile, { encoding: "utf8" }));

            try {
                winston.info(`Updating source native change detection config`);
                await betaSourcesApi.putNativeChangeDetectionConfig({
                    sourceId: currentTargetSource.id,
                    nativeChangeDetectionConfigBeta: nativeChangeCopy
                });
            } catch (error) {
                await handleHttpException(error);
            }
        }

        //Aggregation schedule
        const localScheduleFiles = walk(
            `./build/config/SOURCE/${localSource.name}/${AGGREGATION_SCHEDULE}`
        );
        for (const localScheduleFile of localScheduleFiles) {
            let scheduleCopy = JSON.parse(
                fs.readFileSync(localScheduleFile, { encoding: "utf8" })
            );
            let createSchedule = true;

            //Get all schedules from current target source
            let currentTargetScheduleResponse;
            currentTargetScheduleResponse = await sourcesV2025Api
                .getSourceSchedules({
                    sourceId: currentTargetSource.id,
                })
                .catch((error) => {
                    handleHttpException(error);
                });

            if (currentTargetScheduleResponse) {
                for (const currentSchedule of currentTargetScheduleResponse.data) {
                    //Need to compare the types till we find a match
                    if (currentSchedule.type === scheduleCopy.type) {
                        //Update schedule
                        winston.info(
                            `Updating existing source schedule: ${localSource.name} - ${scheduleCopy.type}`
                        );
                        try {
                            await sourcesV2025Api.updateSourceSchedule({
                                sourceId: currentTargetSource.id,
                                scheduleType: currentSchedule.type,
                                jsonPatchOperationV2025: [
                                    {
                                        op: "replace",
                                        path: "/cronExpression",
                                        value: scheduleCopy.cronExpression,
                                    },
                                ],
                            });
                        } catch (error) {
                            await handleHttpException(error);
                        }

                        //schedule exists already in target, set flag
                        createSchedule = false;
                        break;
                    }
                }
            }

            //Only create if it wasn't found in the target
            if (createSchedule) {
                winston.info(
                    `Creating new source schedule: ${localSource.name} - ${scheduleCopy.type}`
                );
                try {
                    await sourcesV2025Api.createSourceSchedule({
                        sourceId: currentTargetSource.id,
                        schedule1V2025: {
                            type: scheduleCopy.type,
                            cronExpression: scheduleCopy.cronExpression,
                        },
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            }
        }

        //Machine classification config
        winston.info(`Updating source machine classification config`);
        const localMachineClassificationFiles = walk(`./build/config/SOURCE/${localSource.name}/${MACHINE_CLASSIFICATION}`);
        for (const localMachineClassificationFile of localMachineClassificationFiles) {
            let machineClassificationCopy = JSON.parse(fs.readFileSync(localMachineClassificationFile, { encoding: "utf8" }));
            _.set(machineClassificationCopy, "sourceId", currentTargetSource.id);

            try {
                await axios.request({
                    method: "put",
                    url: `${apiConfig.basePath}/v2025/sources/${currentTargetSource.id}/machine-classification-config`,
                    headers: {
                        Authorization: `Bearer ${await apiConfig.accessToken}`,
                        "X-SailPoint-Experimental": "true"
                    },
                    data: machineClassificationCopy
                });
            } catch (error) {
                await handleHttpException(error);
            }
        }

        //Machine mapping config
        winston.info(`Updating source machine mapping config`);
        const localMachineMappingFiles = walk(`./build/config/SOURCE/${localSource.name}/${MACHINE_MAPPING}`);
        for (const localMachineMappingFile of localMachineMappingFiles) {
            let machineMappingsCopy = JSON.parse(fs.readFileSync(localMachineMappingFile, { encoding: "utf8" }));

            //Iterate each identity attribute mapping and update references
            for (let mapping of machineMappingsCopy) {
                let transformDefinition = mapping.transformDefinition;
                const definitionType = transformDefinition.type;

                if (definitionType === "accountAttribute" || definitionType === "reference") {
                    //Looks for accountAttribute source first, if not truthy, assumes it's a transform reference and dives deeper for source reference
                    const mappingSourceName = !!transformDefinition.attributes.sourceName ? transformDefinition.attributes.sourceName : transformDefinition.attributes.input.attributes.sourceName;
                    const mappingSourceResponse = await sourcesApi.listSources({
                        filters: `name eq "${mappingSourceName}"`,
                        limit: 1
                    }).catch(error => {
                        handleHttpException(error);
                    });
                    let currentMappingSource = mappingSourceResponse.data.length == 1 ? mappingSourceResponse.data[0] : null;
                    if (!currentMappingSource) throw new Error(`Cannot find source [${mappingSourceName}] for attribute mapping [${mapping.target.attributeName}] for machine mapping on source [${localSource.name}] in target environment`);

                    //Update source ID reference
                    if (definitionType === "accountAttribute") {
                        mapping.transformDefinition.attributes.sourceId = currentMappingSource.id;
                    } else if (definitionType === "reference") {
                        mapping.transformDefinition.attributes.input.attributes.sourceId = currentMappingSource.id;
                    }
                }
            }

            try {
                await axios.request({
                    method: "put",
                    url: `${apiConfig.basePath}/v2025/sources/${currentTargetSource.id}/machine-account-mappings`,
                    headers: {
                        Authorization: `Bearer ${await apiConfig.accessToken}`,
                        "X-SailPoint-Experimental": "true"
                    },
                    data: machineMappingsCopy
                });
            } catch (error) {
                await handleHttpException(error);
            }
        }

        //Upload connector files. connector_files is a CSV of the referenced JAR files
        if (!skipConnectorLib) {
            const connectorFiles =
                localSource.connectorAttributes.connector_files;
            if (connectorFiles) {
                const connectorFileList = connectorFiles.split(",");
                for (const connectorFileName of connectorFileList) {
                    const relativeFilePath = `connectorLib/${connectorFileName}`;
                    winston.info(
                        `Uploading connector library file [${relativeFilePath}]`
                    );

                    if (!fs.existsSync(relativeFilePath)) {
                        winston.error(
                            `Could not find connector library dependency [${relativeFilePath}]. Put the file in the directory and try again`
                        );
                        process.exit(1);
                    }

                    const fullFilePath = path.resolve(relativeFilePath);
                    const fileStream = fs.createReadStream(fullFilePath);

                    /* Couldn't get this working, had to make call ourselves below
                    await sourcesApi.importConnectorFile({
                        sourceId: currentTargetSource.id,
                        file: fileStream
                    });
                    */

                    let data = new FormData();
                    data.append("file", fileStream);

                    let config = {
                        method: "post",
                        maxBodyLength: Infinity,
                        url: `${apiConfig.basePath}/v3/sources/${currentTargetSource.id}/upload-connector-file`,
                        headers: {
                            Authorization: `Bearer ${await apiConfig.accessToken}`,
                            ...data.getHeaders(),
                        },
                        data: data,
                    };

                    try {
                        await axios.request(config);
                    } catch (error) {
                        await handleHttpException(error);
                    }
                }
            }
        } else {
            winston.warn(
                clc.yellow("Connector dependency file upload set to be skipped")
            );
        }

        //Restore attributes from the currently deployed target source into our template source
        for (const sourceKey of existingAttributeToKeep) {
            _.set(
                localSource,
                sourceKey,
                _.get(currentTargetSource, sourceKey)
            );
        }

        //Update the source with all config, references, etc.
        winston.info(
            `Updating existing source: ${currentTargetSource.name} (${currentTargetSource.id})`
        );
        winston.debug(JSON.stringify(localSource, null, 4));
        try {
            await sourcesApi.putSource({
                id: currentTargetSource.id,
                source: localSource,
            });
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.error(
            `Source [${localSource.name}] does not exist and did not get created properly in the target tenant. Schemas, policies, etc. cannot be processed`
        );
    }
};

const processSchema = async (
    api,
    localSource,
    currentTargetSource,
    localSchemaFile,
    schemaReferences
) => {
    let schemaCopy = JSON.parse(
        fs.readFileSync(localSchemaFile, { encoding: "utf8" })
    );
    let createSchema = true;

    if (schemaReferences[schemaCopy.name]) {
        const currentSchema = schemaReferences[schemaCopy.name];
        schemaCopy.id = currentSchema.id;

        if (schemaCopy.attributes) {
            for (let schemaAttribute of schemaCopy.attributes) {
                if (schemaAttribute.schema) {
                    if (schemaReferences[schemaAttribute.schema.name]) {
                        const refSchema =
                            schemaReferences[schemaAttribute.schema.name];
                        schemaAttribute.schema.id = refSchema.id;
                    }
                }
            }
        }

        winston.info(
            `Updating existing source schema: ${localSource.name} - ${schemaCopy.name}`
        );
        try {
            await api.putSourceSchema({
                schema: schemaCopy,
                schemaId: currentSchema.id,
                sourceId: currentTargetSource.id,
            });

            if (localSource.schemas) {
                for (let schemaReference of localSource.schemas) {
                    if (schemaReference.name === schemaCopy.name) {
                        schemaReference.id = currentSchema.id;
                    }
                }
            }
        } catch (error) {
            await handleHttpException(error);
        }

        createSchema = false;
    }

    if (createSchema) {
        winston.info(
            `Creating new source schema: ${localSource.name} - ${schemaCopy.name}`
        );
        try {
            const createSchemaResponse = await api.createSourceSchema({
                schema: schemaCopy,
                sourceId: currentTargetSource.id,
            });

            const schemaRef = {
                type: CONNECTOR_SCHEMA,
                name: schemaCopy.name,
                id: createSchemaResponse.data.id,
            };

            let currentSchemas = localSource.schemas;
            if (currentSchemas) {
                currentSchemas.push(schemaRef);
                localSource.schemas = currentSchemas;
            }
            return createSchemaResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    }
};

const migrateSources = async (apiConfig, skipConnectorLib) => {
    winston.info(clc.bgBlueBright("Starting Source Deployment"));
    //Only read one directory down where main source files are
    const sourceFilePaths = walk("./build/config/SOURCE", 1);

    //Iterate each source and pass it to migrateSource
    for (const sourceFilePath of sourceFilePaths) {
        const source = fs.readFileSync(sourceFilePath);
        await migrateSource(apiConfig, source, skipConnectorLib);
    }
    winston.info(clc.bgGreen("Completed Source Deployment"));
};

export {
    exportSources,
    getSourceById,
    getSourceByName,
    migrateSource,
    migrateSources,
};
