import winston from "winston";
import clc from "cli-color";
import _ from "lodash";
import * as fs from "fs";
import { AccessProfilesApi, Paginator } from "sailpoint-api-client";
import { handleHttpException, writeConfigFile, walk } from "../util.js";
import { getGovGroupById, getGovGroupByName, getIdentityByAlias, getIdentityById } from "./identityService.js";
import { getEntitlementById, getEntitlementByName } from "./entitlementService.js";
import { getSourceByName } from "./sourceService.js";
import { getWorkflowById, getWorkflowByName } from "./workflowService.js";

const ACCESS_PROFILE = "ACCESS_PROFILE";
const existingAttributeToKeep = ["id"];

const getAccessProfileById = async (apiConfig, accessProfileId) => {
    const accessProfilesApi = new AccessProfilesApi(apiConfig);
    const accessProfile = await accessProfilesApi.getAccessProfile({
        id: accessProfileId,
    });

    if (!accessProfile.data) {
        throw new Error(
            `Could not find an Access Profile for id [${accessProfileId}] in tenant: ${apiConfig.basePath}`
        );
    }

    return accessProfile.data;
};

const getAccessProfileByName = async (apiConfig, accessProfileName) => {
    const accessProfilesApi = new AccessProfilesApi(apiConfig);
    const accessProfileResponse = await accessProfilesApi.listAccessProfiles({
        filters: `name eq "${accessProfileName}"`,
        limit: 1,
    });

    const accessProfile = accessProfileResponse.data.length == 1 ? accessProfileResponse.data[0] : null;

    if (!accessProfile)
        throw new Error(
            `Could not find access profile by name [${accessProfileName}] in tenant: ${apiConfig.basePath}`
        );
    return accessProfile;
};

/**
 * Gets all access profiles and write appropriate
 * access profile files and referenced objects
 * @param {Configuration} apiConfig
 */
const exportAccessProfiles = async apiConfig => {
    winston.info(clc.bgBlueBright("Starting Access Profile Export"));
    const accessProfilesApi = new AccessProfilesApi(apiConfig);
    const accessProfiles = await Paginator.paginate(
        accessProfilesApi,
        accessProfilesApi.listAccessProfiles,
        undefined,
        250
    ).catch(error => {
        handleHttpException(error);
    });

    for (const accessProfile of accessProfiles.data) {
        winston.info(`Exporting Access Profile: ${accessProfile.name} (${accessProfile.id})`);

        //Update owner to alias for lookup when migrating
        const owner = await getIdentityById(apiConfig, accessProfile.owner.id);
        accessProfile.owner.name = owner.alias;

        // check the approvalSchemes for accessRequestConfig and revocationRequestConfig
        // update ids of governance groups or workflows with the name of the object
        // id of the object is in approverId
        // replace approverId with the name of the object
        // e.g. { "approverType": "GOVERNANCE_GROUP", "approverId": "7991cb64-1e10-449a-8a4d-ecfa69072442" }
        // e.g. { "approverType": "WORKFLOW", "approverId": "d11cafd6-0345-45bd-8978-50b077acd5b0" }
        if (accessProfile.accessRequestConfig != null && accessProfile.accessRequestConfig.approvalSchemes != null) {
            for (const scheme of accessProfile.accessRequestConfig.approvalSchemes) {
                switch (scheme.approverType) {
                    case "GOVERNANCE_GROUP":
                        const govGroup = await getGovGroupById(apiConfig, scheme.approverId);
                        scheme.approverId = govGroup.name;
                        break;
                    case "WORKFLOW":
                        const workflow = await getWorkflowById(apiConfig, scheme.approverId);
                        scheme.approverId = workflow.name;
                        break;
                    default:
                        break;
                }
            }
        }
        if (
            accessProfile.revocationRequestConfig != null &&
            accessProfile.revocationRequestConfig.approvalSchemes != null
        ) {
            for (const scheme of accessProfile.revocationRequestConfig.approvalSchemes) {
                switch (scheme.approverType) {
                    case "GOVERNANCE_GROUP":
                        const govGroup = await getGovGroupById(apiConfig, scheme.approverId);
                        scheme.approverId = govGroup.name;
                        break;
                    case "WORKFLOW":
                        const workflow = await getWorkflowById(apiConfig, scheme.approverId);
                        scheme.approverId = workflow.name;
                        break;
                    default:
                        break;
                }
            }
        }

        // Add value and attribute to entitlements for lookup when migrating
        // this will allow lookup by source name, name, value, and attribute to get an exact match of the entitlement id
        const entitlements = [];
        for (const accessProfileEntitlement of accessProfile.entitlements) {
            const entitlement = await getEntitlementById(apiConfig, accessProfileEntitlement.id);
            entitlements.push({
                sourceName: entitlement.source.name,
                name: entitlement.name,
                value: entitlement.value,
                attribute: entitlement.attribute,
            });
        }
        _.set(accessProfile, "entitlements", entitlements);

        // persist the config file
        writeConfigFile(ACCESS_PROFILE, accessProfile.name, accessProfile);
    }
};

const migrateAccessProfile = async (apiConfig, accessProfileJson) => {
    const accessProfilesApi = new AccessProfilesApi(apiConfig);
    let localAccessProfile = JSON.parse(accessProfileJson);

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(apiConfig, localAccessProfile.owner.name);
    _.set(localAccessProfile, "owner.id", owner.id);

    //Get corresponding source by name and add id
    const source = await getSourceByName(apiConfig, localAccessProfile.source.name);
    _.set(localAccessProfile, "source.id", source.id);

    // update ids in approvalSchemes
    if (
        localAccessProfile.accessRequestConfig != null &&
        localAccessProfile.accessRequestConfig.approvalSchemes != null
    ) {
        for (const scheme of localAccessProfile.accessRequestConfig.approvalSchemes) {
            switch (scheme.approverType) {
                case "GOVERNANCE_GROUP":
                    const govGroup = await getGovGroupByName(apiConfig, scheme.approverId);
                    scheme.approverId = govGroup.id;
                    break;
                case "WORKFLOW":
                    const workflow = await getWorkflowByName(apiConfig, scheme.approverId);
                    scheme.approverId = workflow.id;
                    break;
                default:
                    break;
            }
        }
    }
    if (
        localAccessProfile.revocationRequestConfig != null &&
        localAccessProfile.revocationRequestConfig.approvalSchemes != null
    ) {
        for (const scheme of localAccessProfile.revocationRequestConfig.approvalSchemes) {
            switch (scheme.approverType) {
                case "GOVERNANCE_GROUP":
                    const govGroup = await getGovGroupByName(apiConfig, scheme.approverId);
                    scheme.approverId = govGroup.id;
                    break;
                case "WORKFLOW":
                    const workflow = await getWorkflowByName(apiConfig, scheme.approverId);
                    scheme.approverId = workflow.id;
                    break;
                default:
                    break;
            }
        }
    }

    // add id to the entitlements in the access profile
    // and remove all other attributes except for type, id, and name
    // the other attributes are only used for the lookup
    const entitlements = [];
    for (const accessProfileEntitlement of localAccessProfile.entitlements) {
        const entitlement = await getEntitlementByName(
            apiConfig,
            accessProfileEntitlement.sourceName,
            accessProfileEntitlement.name,
            accessProfileEntitlement.value,
            accessProfileEntitlement.attribute
        );
        entitlements.push({
            id: entitlement.id,
            type: "ENTITLEMENT",
            name: entitlement.name,
        });
    }
    _.set(localAccessProfile, "entitlements", entitlements);

    //Check if the access profile already exists
    const currentAccessProfileResponse = await accessProfilesApi
        .listAccessProfiles({
            filters: `name eq "${localAccessProfile.name}"`,
        })
        .catch(error => {
            handleHttpException(error);
        });
    let currentTargetAccessProfile =
        currentAccessProfileResponse.data.length == 1 ? currentAccessProfileResponse.data[0] : null;

    if (!currentTargetAccessProfile) {
        winston.info(`Creating new access profile: ${localAccessProfile.name}`);
        try {
            const createAccessProfileResponse = await accessProfilesApi.createAccessProfile({
                accessProfile: localAccessProfile,
            });
            currentTargetAccessProfile = createAccessProfileResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(
            `Updating existing access profile: ${currentTargetAccessProfile.name} (${currentTargetAccessProfile.id})`
        );

        //Restore attributes from the currently deployed target object into our template object
        for (const key of existingAttributeToKeep) {
            _.set(localAccessProfile, key, _.get(currentTargetAccessProfile, key));
        }

        //Craft the list of update operations to be performed
        const patchOperations = [
            {
                op: "replace",
                path: "/name",
                value: localAccessProfile.name,
            },
            {
                op: "replace",
                path: "/description",
                value: localAccessProfile.description,
            },
            {
                op: "replace",
                path: "/enabled",
                value: localAccessProfile.enabled,
            },
            {
                op: "replace",
                path: "/owner",
                value: localAccessProfile.owner,
            },
            {
                op: "replace",
                path: "/requestable",
                value: localAccessProfile.requestable,
            },
            {
                op: "replace",
                path: "/accessRequestConfig",
                value: localAccessProfile.accessRequestConfig,
            },
            {
                op: "replace",
                path: "/revocationRequestConfig",
                value: localAccessProfile.revocationRequestConfig,
            },
            {
                op: "replace",
                path: "/segments",
                value: localAccessProfile.segments,
            },
            {
                op: "replace",
                path: "/entitlements",
                value: localAccessProfile.entitlements,
            },
            {
                op: "replace",
                path: "/provisioningCriteria",
                value: localAccessProfile.provisioningCriteria,
            },
            {
                op: "replace",
                path: "/source",
                value: localAccessProfile.source,
            },
            {
                op: "replace",
                path: "/additionalOwners",
                value: localAccessProfile.additionalOwners,
            },
        ];

        // perform the update
        try {
            await accessProfilesApi.patchAccessProfile({
                id: currentTargetAccessProfile.id,
                jsonPatchOperation: patchOperations,
            });
        } catch (error) {
            await handleHttpException(error);
        }
    }
};

const migrateAccessProfiles = async apiConfig => {
    winston.info(clc.bgBlueBright("Starting Access Profile Deployment"));
    //Only read one directory down where main source files are
    const accessProfileFilePaths = walk(`./build/config/${ACCESS_PROFILE}`);

    //Iterate each access profile and pass it to migrateAccessProfile
    for (const accessProfileFilePath of accessProfileFilePaths) {
        const accessProfile = fs.readFileSync(accessProfileFilePath);
        await migrateAccessProfile(apiConfig, accessProfile);
    }
    winston.info(clc.bgGreen("Completed Access Profile Deployment"));
};

export { getAccessProfileById, getAccessProfileByName, exportAccessProfiles, migrateAccessProfiles };
