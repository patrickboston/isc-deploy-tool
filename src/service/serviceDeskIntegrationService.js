import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { Configuration, Paginator, ServiceDeskIntegrationApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, walk, writeConfigFile } from "../util.js";
import { getAllClusters } from "./clusterService.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";
import { getAllRules } from "./ruleService.js";
import { getSourceByName, getSourceById } from "./sourceService.js";

const existingAttributeToKeep = [
    "id", "authoritative", "connectorAttributes.cloudExternalId", "passwordPolicies", "connectorAttributes.healthy", "healthy"
];
const ruleReferenceNames = [
    "beforeProvisioningRule"
];
/**
* Gets all service desk integrations via v3/service-desk-integrations and write appropriate 
* service desk integration files
* @param {Configuration} apiConfig
*/
const exportServiceDeskIntegrations = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Service Desk Integration Export"));
    const serviceDeskIntegrationApi = new ServiceDeskIntegrationApi(apiConfig);

    const serviceDeskIntegrationsResponse = await Paginator.paginate(serviceDeskIntegrationApi, serviceDeskIntegrationApi.getServiceDeskIntegrations, undefined, 250);
    for (const serviceDeskIntegration of serviceDeskIntegrationsResponse.data) {
        //Clone for modifications
        let serviceDeskIntegrationClone = structuredClone(serviceDeskIntegration);
        const serviceDeskIntegrationName = serviceDeskIntegration.name;
        winston.info(`Exporting Service Desk Integration: ${serviceDeskIntegration.name} (${serviceDeskIntegration.id})`);

        //Update source owner to alias for lookup when migrating
        const owner = await getIdentityById(apiConfig, serviceDeskIntegration.ownerRef.id);
        serviceDeskIntegrationClone.ownerRef.name = owner.alias;

        //Update requesterSource with name for easier local refernece/deployment
        const requesterSourceId = serviceDeskIntegrationClone.attributes.requesterSource;
        if (requesterSourceId) {
            const requesterSource = await getSourceById(apiConfig, requesterSourceId);
            serviceDeskIntegrationClone.attributes.requesterSource = requesterSource.name;
        }

        //Write the actual source
        writeConfigFile("SERVICE_DESK_INTEGRATION", serviceDeskIntegrationName, serviceDeskIntegrationClone);
    }
};

/**
* Creates or updates a service desk integration in the target tenant
* @param {Configuration} apiConfig  SailPoint API Config
* @param {string} serviceDeskIntegrationJson  Raw JSON String of source to be deployed
*/
const migrateServiceDeskIntegration = async (apiConfig, serviceDeskIntegrationJson) => {
    const serviceDeskIntegrationApi = new ServiceDeskIntegrationApi(apiConfig);
    let localServiceDeskIntegration = JSON.parse(serviceDeskIntegrationJson);

    //Get corresponding cluster by name and add id
    if (localServiceDeskIntegration.clusterRef) {
        const clusters = await getAllClusters(apiConfig);
        for (const cluster of clusters) {
            if (localServiceDeskIntegration.clusterRef.name === cluster.name) {
                _.set(localServiceDeskIntegration, "clusterRef.id", cluster.id)
            }
        }
    }

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(apiConfig, _.get(localServiceDeskIntegration, "ownerRef.name"));
    _.set(localServiceDeskIntegration, "ownerRef.id", owner.id);

    //Update provisioningConfig with source references
    let managedResourceRefs = localServiceDeskIntegration.provisioningConfig.managedResourceRefs;
    if (managedResourceRefs && managedResourceRefs.length > 0) {
        for (let managedResourceRef of managedResourceRefs) {
            const targetSource = await getSourceByName(apiConfig, managedResourceRef.name);
            managedResourceRef.id = targetSource.id;
        }
    }

    //Requester was replaced with name on export, needs to be an ID on import
    const requesterSourceName = localServiceDeskIntegration.attributes.requesterSource;
    if (requesterSourceName) {
        const requesterSource = await getSourceByName(apiConfig, requesterSourceName);
        localServiceDeskIntegration.attributes.requesterSource = requesterSource.id;
    }

    //Check and see if a source with this name already exists in the target environment
    const currentServiceDeskIntegrationResponse = await serviceDeskIntegrationApi.getServiceDeskIntegrations({
        filters: `name eq "${localServiceDeskIntegration.name}"`,
        limit: 1
    });

    let currentTargetServiceDeskIntegration = currentServiceDeskIntegrationResponse.data.length == 1 ? currentServiceDeskIntegrationResponse.data[0] : null;

    //If the source does not exist, we need to create at least a shell source so schemas, etc. can reference it
    if (!currentTargetServiceDeskIntegration) {
        winston.info(`Creating new service desk integration: ${localServiceDeskIntegration.name}`);

        try {
            const createServiceDeskIntegrationResponse = await serviceDeskIntegrationApi.createServiceDeskIntegration({
                serviceDeskIntegrationDto: {
                    name: localServiceDeskIntegration.name,
                    description: localServiceDeskIntegration.description,
                    type: localServiceDeskIntegration.type,
                    attributes: localServiceDeskIntegration.attributes,
                    beforeProvisioningRule: localServiceDeskIntegration.beforeProvisioningRule,
                    clusterRef: localServiceDeskIntegration.clusterRef,
                    ownerRef: localServiceDeskIntegration.ownerRef,
                    provisioningConfig: localServiceDeskIntegration.provisioningConfig
                }
            });

            currentTargetServiceDeskIntegration = createServiceDeskIntegrationResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(`Updating existing service desk integration: ${currentTargetServiceDeskIntegration.name} (${currentTargetServiceDeskIntegration.id})`)
        //Update all rule references
        const rules = await getAllRules(apiConfig);

        for (const ruleReferenceName of ruleReferenceNames) {
            if (_.get(localServiceDeskIntegration, ruleReferenceName)) {
                let ruleRef = _.get(localServiceDeskIntegration, ruleReferenceName);

                for (const rule of rules) {
                    if (rule.self.name === ruleRef.name) {
                        ruleRef.id = rule.self.id;
                        _.set(localServiceDeskIntegration, ruleReferenceName, ruleRef);
                    }
                }
            }
        }

        try {
            await serviceDeskIntegrationApi.putServiceDeskIntegration({
                id: currentTargetServiceDeskIntegration.id,
                serviceDeskIntegrationDto: {
                    name: localServiceDeskIntegration.name,
                    description: localServiceDeskIntegration.description,
                    type: localServiceDeskIntegration.type,
                    attributes: localServiceDeskIntegration.attributes,
                    beforeProvisioningRule: localServiceDeskIntegration.beforeProvisioningRule,
                    clusterRef: localServiceDeskIntegration.clusterRef,
                    ownerRef: localServiceDeskIntegration.ownerRef,
                    provisioningConfig: localServiceDeskIntegration.provisioningConfig
                }
            });
        } catch (error) {
            await handleHttpException(error);
        }
    }
}


const migrateServiceDeskIntegrations = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Service Desk Integration Deployment"));
    const serviceDeskIntegrationFilePaths = walk("./build/config/SERVICE_DESK_INTEGRATION");

    //Iterate each service desk integration and pass it to migrateServiceDeskIntegration
    for (const serviceDeskIntegrationFilePath of serviceDeskIntegrationFilePaths) {
        const serviceDeskIntegration = fs.readFileSync(serviceDeskIntegrationFilePath);
        await migrateServiceDeskIntegration(apiConfig, serviceDeskIntegration);
    }
    winston.info(clc.bgGreen("Completed Service Desk Integration Deployment"));
}

export {
    exportServiceDeskIntegrations, migrateServiceDeskIntegrations
};

