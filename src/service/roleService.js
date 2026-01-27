import winston from 'winston';
import clc from 'cli-color';
import _ from 'lodash';
import * as fs from 'fs';
import { Paginator, RolesApi } from 'sailpoint-api-client';
import { handleHttpException, writeConfigFile, walk } from '../util.js';
import {
    getGovGroupById,
    getGovGroupByName,
    getIdentityByAlias,
    getIdentityById,
} from './identityService.js';
import {
    getEntitlementById,
    getEntitlementByName,
} from './entitlementService.js';
import { getWorkflowById, getWorkflowByName } from './workflowService.js';
import { getSourceById, getSourceByName } from './sourceService.js';
import { getAccessProfileByName } from './accessProfileService.js';

const ROLE = 'ROLE';
const existingAttributeToKeep = ['id'];

const getRoleById = async (apiConfig, roleId) => {
    const rolesApi = new RolesApi(apiConfig);
    const role = await rolesApi.getRole({
        id: roleId,
    });

    if (!role.data) {
        throw new Error(
            `Could not find a role for id [${roleId}] in tenant: ${apiConfig.basePath}`,
        );
    }

    return role.data;
};

const getRoleByName = async (apiConfig, roleName) => {
    const rolesApi = new RolesApi(apiConfig);
    const roleResponse = await rolesApi.listRoles({
        filters: `name eq "${roleName}"`,
        limit: 1,
    });

    const role = roleResponse.data.length == 1 ? roleResponse.data[0] : null;

    if (!role)
        throw new Error(
            `Could not find role by name [${roleName}] in tenant: ${apiConfig.basePath}`,
        );
    return role;
};

/**
 * Updates ids in membership/assignment criteria for a role
 * such as sourceId
 * @param {Configuration} apiConfig
 * @param {Array} children
 * @param {boolean} isExport
 */
const updateMembershipChildren = async (apiConfig, children, isExport) => {
    for (const child of children) {
        if (child.children != null && child.children.length > 0) {
            await updateMembershipChildren(apiConfig, child.children, isExport);
        } else if (
            child.key.type === 'ACCOUNT' ||
            child.key.type === 'ENTITLEMENT'
        ) {
            // replace sourceId with source name
            if (isExport === true) {
                const source = await getSourceById(
                    apiConfig,
                    child.key.sourceId,
                );
                child.key.sourceId = source.name;
            }
            // replace sourceId with source id
            else {
                const source = await getSourceByName(
                    apiConfig,
                    child.key.sourceId,
                );
                child.key.sourceId = source.id;
            }
        }
    }
};

/**
 * Gets all roles and write appropriate
 * role files and referenced objects
 * @param {Configuration} apiConfig
 */
const exportRoles = async (apiConfig) => {
    winston.info(clc.bgBlueBright('Starting Role Export'));
    const rolesApi = new RolesApi(apiConfig);
    const roles = await Paginator.paginate(
        rolesApi,
        rolesApi.listRoles,
        undefined,
        250,
    ).catch((error) => {
        handleHttpException(error);
    });

    for (const role of roles.data) {
        winston.info(`Exporting Role: ${role.name} (${role.id})`);

        //Update owner to alias for lookup when migrating
        const owner = await getIdentityById(apiConfig, role.owner.id);
        role.owner.name = owner.alias;

        // replace ids in membership
        // type ACCOUNT replace sourceId with source name
        // type ENTITLEMENT replace sourceId with source name
        // this needs to be a recursive operation because a child can have children e.g. Criteria Groups in the role assignment
        if (
            role.membership != null &&
            role.membership.criteria != null &&
            role.membership.criteria.children != null
        ) {
            await updateMembershipChildren(
                apiConfig,
                role.membership.criteria.children,
                true,
            );
        }

        // check the approvalSchemes for accessRequestConfig and revocationRequestConfig
        // update ids of governance groups or workflows with the name of the object
        // id of the object is in approverId
        // replace approverId with the name of the object
        // e.g. { "approverType": "GOVERNANCE_GROUP", "approverId": "7991cb64-1e10-449a-8a4d-ecfa69072442" }
        // e.g. { "approverType": "WORKFLOW", "approverId": "d11cafd6-0345-45bd-8978-50b077acd5b0" }
        if (
            role.accessRequestConfig != null &&
            role.accessRequestConfig.approvalSchemes != null
        ) {
            for (const scheme of role.accessRequestConfig.approvalSchemes) {
                switch (scheme.approverType) {
                    case 'GOVERNANCE_GROUP':
                        const govGroup = await getGovGroupById(
                            apiConfig,
                            scheme.approverId,
                        );
                        scheme.approverId = govGroup.name;
                        break;
                    case 'WORKFLOW':
                        const workflow = await getWorkflowById(
                            apiConfig,
                            scheme.approverId,
                        );
                        scheme.approverId = workflow.name;
                        break;
                    default:
                        break;
                }
            }
        }
        if (
            role.revocationRequestConfig != null &&
            role.revocationRequestConfig.approvalSchemes != null
        ) {
            for (const scheme of role.revocationRequestConfig.approvalSchemes) {
                switch (scheme.approverType) {
                    case 'GOVERNANCE_GROUP':
                        const govGroup = await getGovGroupById(
                            apiConfig,
                            scheme.approverId,
                        );
                        scheme.approverId = govGroup.name;
                        break;
                    case 'WORKFLOW':
                        const workflow = await getWorkflowById(
                            apiConfig,
                            scheme.approverId,
                        );
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
        for (const roleEntitlement of role.entitlements) {
            const entitlement = await getEntitlementById(
                apiConfig,
                roleEntitlement.id,
            );
            entitlements.push({
                sourceName: entitlement.source.name,
                name: entitlement.name,
                value: entitlement.value,
                attribute: entitlement.attribute,
            });
        }
        _.set(role, 'entitlements', entitlements);

        // persist the config file
        writeConfigFile(ROLE, role.name, role);
    }
};

const migrateRole = async (apiConfig, roleJson) => {
    const rolesApi = new RolesApi(apiConfig);
    let localRole = JSON.parse(roleJson);

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(apiConfig, localRole.owner.name);
    _.set(localRole, 'owner.id', owner.id);

    //Add ids to access profiles
    if (
        localRole.accessProfiles != null &&
        localRole.accessProfiles.length > 0
    ) {
        for (const roleAccessProfile of localRole.accessProfiles) {
            const accessProfile = await getAccessProfileByName(
                apiConfig,
                roleAccessProfile.name,
            );
            _.set(roleAccessProfile, 'id', accessProfile.id);
        }
    }

    //Add ids to identities in the membership
    if (
        localRole.membership != null &&
        localRole.membership.identities != null &&
        localRole.membership.identities.length > 0
    ) {
        for (const roleIdentity of localRole.membership.identities) {
            const identity = await getIdentityByAlias(
                apiConfig,
                roleIdentity.aliasName,
            );
            _.set(roleIdentity, 'id', identity.id);
        }
    }

    // replace names in membership
    // type ACCOUNT replace sourceId with source name
    // type ENTITLEMENT replace sourceId with source name
    // this needs to be a recursive operation because a child can have children e.g. Criteria Groups in the role assignment
    if (
        localRole.membership != null &&
        localRole.membership.criteria != null &&
        localRole.membership.criteria.children != null
    ) {
        await updateMembershipChildren(
            apiConfig,
            localRole.membership.criteria.children,
            false,
        );
    }

    // update ids in approvalSchemes
    if (
        localRole.accessRequestConfig != null &&
        localRole.accessRequestConfig.approvalSchemes != null
    ) {
        for (const scheme of localRole.accessRequestConfig.approvalSchemes) {
            switch (scheme.approverType) {
                case 'GOVERNANCE_GROUP':
                    const govGroup = await getGovGroupByName(
                        apiConfig,
                        scheme.approverId,
                    );
                    scheme.approverId = govGroup.id;
                    break;
                case 'WORKFLOW':
                    const workflow = await getWorkflowByName(
                        apiConfig,
                        scheme.approverId,
                    );
                    scheme.approverId = workflow.id;
                    break;
                default:
                    break;
            }
        }
    }
    if (
        localRole.revocationRequestConfig != null &&
        localRole.revocationRequestConfig.approvalSchemes != null
    ) {
        for (const scheme of localRole.revocationRequestConfig
            .approvalSchemes) {
            switch (scheme.approverType) {
                case 'GOVERNANCE_GROUP':
                    const govGroup = await getGovGroupByName(
                        apiConfig,
                        scheme.approverId,
                    );
                    scheme.approverId = govGroup.id;
                    break;
                case 'WORKFLOW':
                    const workflow = await getWorkflowByName(
                        apiConfig,
                        scheme.approverId,
                    );
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
    for (const roleEntitlement of localRole.entitlements) {
        const entitlement = await getEntitlementByName(
            apiConfig,
            roleEntitlement.sourceName,
            roleEntitlement.name,
            roleEntitlement.value,
            roleEntitlement.attribute,
        );
        entitlements.push({
            id: entitlement.id,
            type: 'ENTITLEMENT',
            name: entitlement.name,
        });
    }
    _.set(localRole, 'entitlements', entitlements);

    //Check if the role already exists
    const currentRoleResponse = await rolesApi
        .listRoles({
            filters: `name eq "${localRole.name}"`,
        })
        .catch((error) => {
            handleHttpException(error);
        });
    let currentTargetRole =
        currentRoleResponse.data.length == 1
            ? currentRoleResponse.data[0]
            : null;

    if (!currentTargetRole) {
        winston.info(`Creating new role: ${localRole.name}`);
        try {
            const createRoleResponse = await rolesApi.createRole({
                role: localRole,
            });
            currentTargetRole = createRoleResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(
            `Updating existing role: ${currentTargetRole.name} (${currentTargetRole.id})`,
        );

        //Restore attributes from the currently deployed target object into our template object
        for (const key of existingAttributeToKeep) {
            _.set(localRole, key, _.get(currentTargetRole, key));
        }

        //Craft the list of update operations to be performed
        const patchOperations = [
            {
                op: 'replace',
                path: '/name',
                value: localRole.name,
            },
            {
                op: 'replace',
                path: '/description',
                value: localRole.description,
            },
            {
                op: 'replace',
                path: '/enabled',
                value: localRole.enabled,
            },
            {
                op: 'replace',
                path: '/owner',
                value: localRole.owner,
            },
            {
                op: 'replace',
                path: '/requestable',
                value: localRole.requestable,
            },
            {
                op: 'replace',
                path: '/accessRequestConfig',
                value: localRole.accessRequestConfig,
            },
            {
                op: 'replace',
                path: '/revocationRequestConfig',
                value: localRole.revocationRequestConfig,
            },
            {
                op: 'replace',
                path: '/segments',
                value: localRole.segments,
            },
            {
                op: 'replace',
                path: '/entitlements',
                value: localRole.entitlements,
            },
            {
                op: 'replace',
                path: '/accessProfiles',
                value: localRole.accessProfiles,
            },
            {
                op: 'replace',
                path: '/membership',
                value: localRole.membership,
            },
            {
                op: 'replace',
                path: '/additionalOwners',
                value: localRole.additionalOwners,
            },
        ];

        // perform the update
        try {
            await rolesApi.patchRole({
                id: currentTargetRole.id,
                jsonPatchOperation: patchOperations,
            });
        } catch (error) {
            await handleHttpException(error);
        }
    }
};

const migrateRoles = async (apiConfig) => {
    winston.info(clc.bgBlueBright('Starting Role Deployment'));
    //Only read one directory down where main source files are
    const roleFilePaths = walk(`./build/config/${ROLE}`);

    //Iterate each access profile and pass it to migrateAccessProfile
    for (const roleFilePath of roleFilePaths) {
        const accessProfile = fs.readFileSync(roleFilePath);
        await migrateRole(apiConfig, accessProfile);
    }
    winston.info(clc.bgGreen('Completed Role Deployment'));
};

export { getRoleById, getRoleByName, exportRoles, migrateRoles };
