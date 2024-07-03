import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { GovernanceGroupsBetaApi, IdentitiesBetaApi, Paginator } from "sailpoint-api-client";
import winston from "winston";
import { walk, writeConfigFile } from "../util.js";

const GOVERNANCE_GROUP_TYPE = "GOVERNANCE_GROUP";
const existingAttributeToKeep = [
    "id"
];

//Cache of identities we fetch during imports
let identityCache = {};
let govGroupCache = {};

const getIdentityByAlias = async (apiConfig, identityAlias) => {
    if (identityCache[identityAlias]) return identityCache[identityAlias];

    const identityApi = new IdentitiesBetaApi(apiConfig);
    const identityResponse = await identityApi.listIdentities({
        filters: `alias eq "${identityAlias}"`,
        defaultFilter: "NONE" //Show hidden SailPoint identities
    });

    if (!identityResponse || identityResponse.data.length === 0) {
        throw new Error(`Could not find identity for alias [${identityAlias}] in tenant: ${apiConfig.basePath}`)
    }

    identityCache[identityAlias] = identityResponse.data[0];
    return identityResponse.data[0];
}

const getIdentityById = async (apiConfig, identityId) => {
    if (identityCache[identityId]) return identityCache[identityId];

    const identityApi = new IdentitiesBetaApi(apiConfig);
    const identityResponse = await identityApi.listIdentities({
        filters: `id eq "${identityId}"`,
        defaultFilter: "NONE" //Show hidden SailPoint identities
    });

    if (!identityResponse || identityResponse.data.length === 0) {
        throw new Error(`Could not find identity for id [${identityId}] in tenant: ${apiConfig.basePath}`)
    }

    return identityResponse.data[0];
}

const getGovGroupByName = async (apiConfig, govGroupName) => {
    if (govGroupCache[govGroupName]) return govGroupCache[govGroupName];

    const govGroupApi = new GovernanceGroupsBetaApi(apiConfig);
    const govGroupResponse = await govGroupApi.listWorkgroups({
        filters: `name eq "${govGroupName}"`
    });

    if (!govGroupResponse || govGroupResponse.data.length === 0) {
        throw new Error(`Could not find governance group/workgroup for name [${govGroupName}] in tenant: ${apiConfig.basePath}`)
    }

    return govGroupResponse.data[0];
}

const getGovGroupById = async (apiConfig, govGroupId) => {
    if (govGroupCache[govGroupId]) return govGroupCache[govGroupId];

    const govGroupApi = new GovernanceGroupsBetaApi(apiConfig);
    const govGroupResponse = await govGroupApi.getWorkgroup({
        id: govGroupId
    });

    if (!govGroupResponse) {
        throw new Error(`Could not find governance group/workgroup for id [${govGroupId}] in tenant: ${apiConfig.basePath}`)
    }

    return govGroupResponse.data;
}

const exportGovernanceGroups = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Governance Group Export"));
    const govGroupApi = new GovernanceGroupsBetaApi(apiConfig);
    const govGroupsResponse = await Paginator.paginate(govGroupApi, govGroupApi.listWorkgroups, { limit: 1000 }, 250);
    for (const govGroup of govGroupsResponse.data) {
        winston.info(`Exporting Governance Group: ${govGroup.name} (${govGroup.id})`);
        writeConfigFile(GOVERNANCE_GROUP_TYPE, govGroup.name, govGroup);
    }
}

const migrateGovernanceGroup = async (apiConfig, govGroupJson) => {
    const govGroupApi = new GovernanceGroupsBetaApi(apiConfig);
    let localGovGroup = JSON.parse(govGroupJson);

    //Looks up owner identity by tokenized alias
    const targetOwner = await getIdentityByAlias(apiConfig, localGovGroup.owner.name);

    //Update id and email reference incase it's different in target env
    localGovGroup.owner.id = targetOwner.id;
    localGovGroup.owner.email = targetOwner.email;

    //Check and see if a gov group with this name already exists in the target environment
    const currentGovGroupResponse = await govGroupApi.listWorkgroups({
        filters: `name eq "${localGovGroup.name}"`
    });
    let currentTargetGovGroup = currentGovGroupResponse.data.length == 1 ? currentGovGroupResponse.data[0] : null;

    if (!currentTargetGovGroup) {
        winston.info(`Creating new governance group/workgroup: ${localGovGroup.name}`);
        const createGovGroupResponse = await govGroupApi.createWorkgroup({
            workgroupDtoBeta: {
                name: localGovGroup.name,
                description: localGovGroup.description,
                owner: localGovGroup.owner
            }
        });
        currentTargetGovGroup = createGovGroupResponse.data;
    } else {
        winston.info(`Updating existing governance group/workgroup: ${currentTargetGovGroup.name} (${currentTargetGovGroup.id})`)
        //Restore attributes from the currently deployed target gov group into our template gov group
        for (const govGroupKey of existingAttributeToKeep) {
            _.set(localGovGroup, govGroupKey, _.get(currentTargetGovGroup, govGroupKey));
        }

        //Update the gov group with all config, references, etc.
        await govGroupApi.patchWorkgroup({
            id: currentTargetGovGroup.id,
            jsonPatchOperationBeta: [
                {
                    op: "replace",
                    path: "/description",
                    value: localGovGroup.description
                }
            ]
        });
    }
}

const migrateGovernanceGroups = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Governance Group Deployment"));
    const governanceGroupsPaths = walk("./build/config/GOVERNANCE_GROUP");

    //Iterate each transform and pass it to migrateTransform
    for (const governanceGroupsPath of governanceGroupsPaths) {
        const governanceGroup = fs.readFileSync(governanceGroupsPath);
        await migrateGovernanceGroup(apiConfig, governanceGroup);
    }
}

export {
    exportGovernanceGroups, getGovGroupById, getGovGroupByName, getIdentityByAlias,
    getIdentityById, migrateGovernanceGroup, migrateGovernanceGroups
};

