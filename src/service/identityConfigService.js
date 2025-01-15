import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { IdentityAttributesBetaApi, IdentityProfilesApi, LifecycleStatesApi, SourcesApi } from "sailpoint-api-client";
import winston from "winston";
import { deepOmit, handleHttpException, walk, writeConfigFile } from "../util.js";
import { getAccessProfileById, getAccessProfileByName } from "./accessProfileService.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";
import { getAllRules } from "./ruleService.js";
import { getSourceById, getSourceByName } from "./sourceService.js";

const IDENTITY_OBJECT_CONFIG = "IDENTITY_OBJECT_CONFIG";
const IDENTITY_PROFILE = "IDENTITY_PROFILE";
const LIFECYCLE_STATE = "LIFECYCLE_STATE";
const identityProfileExistingAttributeToKeep = [
    "object.id", "self.id"
];
const lifecycleStateExistingAttributeToKeep = [
    "id"
];

/**
* Gets all sources via v3/sources and write appropriate 
* Source files and referenced objects
* @param {Configuration} apiConfig
*/
const exportIdentityAttributeConfig = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Identity Attribute Configuration Export"));
    const identityAttributesApi = new IdentityAttributesBetaApi(apiConfig);
    const identityAttributeConfig = await identityAttributesApi.listIdentityAttributes().catch(error => {
        handleHttpException(error);
    });;
    writeConfigFile(IDENTITY_OBJECT_CONFIG, IDENTITY_OBJECT_CONFIG, identityAttributeConfig.data);
};

const exportIdentityProfiles = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Identity Profile Export"));
    const identityProfilesApi = new IdentityProfilesApi(apiConfig);
    const lifecycleStatesApi = new LifecycleStatesApi(apiConfig);
    const identityProfiles = await identityProfilesApi.exportIdentityProfiles().catch(error => {
        handleHttpException(error);
    });
    for (let profile of identityProfiles.data) {
        winston.info(`Exporting Identity Profile: ${profile.self.name} (${profile.self.id})`);
        //Update owner to alias for lookup when migrating, default IDN Admin won't have owner
        if (profile.object.owner) {
            const owner = await getIdentityById(apiConfig, profile.object.owner.id);
            profile.object.owner.name = owner.alias;
        }

        //Lifecycle states are attached to Identity Profiles so let's grab them
        const lifecycleStatesResponse = await lifecycleStatesApi.getLifecycleStates({
            identityProfileId: profile.self.id
        }).catch(error => {
            handleHttpException(error);
        });
        if (lifecycleStatesResponse.data) {
            for (let lifecycleState of lifecycleStatesResponse.data) {
                if (lifecycleState.accountActions) {
                    for (let accountAction of lifecycleState.accountActions) {
                        let sourceNames = [];
                        for (const sourceId of accountAction.sourceIds) {
                            const source = await getSourceById(apiConfig, sourceId);
                            sourceNames.push(source.name);
                        }
                        accountAction.sourceIds = sourceNames;
                    }
                }

                if (lifecycleState.accessProfileIds) {
                    let accessProfileNames = [];
                    for (const accessProfileId of lifecycleState.accessProfileIds) {
                        const accessProfile = await getAccessProfileById(apiConfig, accessProfileId);
                        accessProfileNames.push(accessProfile.name);
                    }
                    lifecycleState.accessProfileIds = accessProfileNames;
                }

                writeConfigFile(LIFECYCLE_STATE, lifecycleState.name, lifecycleState, `IDENTITY_PROFILE/${profile.self.name}/LIFECYCLE_STATE`);
            }
        }

        //This is basically using SP-Config in the backend so we need to reference self.name here
        writeConfigFile(IDENTITY_PROFILE, profile.self.name, profile, `IDENTITY_PROFILE/${profile.self.name}`);
    }
}

const migrateIdentityAttributeConfig = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Identity Attribute Configuration Deployment"));
    const identityAttributesApi = new IdentityAttributesBetaApi(apiConfig);

    const identityAttributeConfigFilePaths = walk("./build/config/IDENTITY_OBJECT_CONFIG");

    //Iterate each source and pass it to migrateSource
    for (const identityAttributeConfigFilePath of identityAttributeConfigFilePaths) {
        const identityAttributeConfigFile = fs.readFileSync(identityAttributeConfigFilePath);

        //Differs from other objects as we need to iterate each attribute in the array of attributes
        let localIdentityAttributeConfig = JSON.parse(identityAttributeConfigFile);
        for (const localIdentityAttribute of localIdentityAttributeConfig) {
            //Check and see if a identity attribute with this name already exists in the target environment
            let currentTargetIdentityAttribute;
            try {
                const currentIdentityAttributeResponse = await identityAttributesApi.getIdentityAttribute({
                    name: localIdentityAttribute.name
                });
                currentTargetIdentityAttribute = currentIdentityAttributeResponse.data;
            } catch (error) {
                if (error.response.status === 404) {
                    winston.debug(`Identity Attribute [${localIdentityAttribute.name}] does not exist yet`);
                } else {
                    handleHttpException(error);
                }
            }

            if (!currentTargetIdentityAttribute) {
                winston.info(clc.bgBlueBright(`Creating new identity attribute for: ${localIdentityAttribute.name}`));
                try {
                    const createIdentityAttributeResponse = await identityAttributesApi.createIdentityAttribute({
                        identityAttributeBeta: {
                            name: localIdentityAttribute.name,
                            displayName: localIdentityAttribute.displayName,
                            multi: localIdentityAttribute.multi,
                            searchable: localIdentityAttribute.searchable,
                            sources: localIdentityAttribute.sources,
                            standard: localIdentityAttribute.standard,
                            system: localIdentityAttribute.system,
                            type: localIdentityAttribute.type
                        }
                    });
                    currentTargetIdentityAttribute = createIdentityAttributeResponse.data;
                } catch (error) {
                    await handleHttpException(error);
                }
            } else {
                winston.info(`Updating existing identity attribute: ${localIdentityAttribute.name}`);

                //Update the identity attribute with all config, references, etc.
                try {
                    await identityAttributesApi.putIdentityAttribute({
                        name: localIdentityAttribute.name,
                        identityAttributeBeta: {
                            name: localIdentityAttribute.name,
                            displayName: localIdentityAttribute.displayName,
                            multi: localIdentityAttribute.multi,
                            searchable: localIdentityAttribute.searchable,
                            sources: localIdentityAttribute.sources,
                            standard: localIdentityAttribute.standard,
                            system: localIdentityAttribute.system,
                            type: localIdentityAttribute.type
                        }
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            }
        }
    }
    winston.info(clc.bgGreen("Completed Identity Attribute Configuration Deployment"));
}

const migrateIdentityProfile = async (apiConfig, identityProfileJson) => {
    const identityProfilesApi = new IdentityProfilesApi(apiConfig);
    const sourcesApi = new SourcesApi(apiConfig);

    let localIdentityProfile = JSON.parse(identityProfileJson);

    //Get all rules incase we need to perform a lookup
    const rules = await getAllRules(apiConfig);

    //Check and see if an identity profile with this name already exists in the target environment
    let currentIdentityProfileResponse = await identityProfilesApi.exportIdentityProfiles({
        filters: `name eq "${localIdentityProfile.object.name}"`
    }).catch(error => {
        handleHttpException(error);
    });
    let currentTargetIdentityProfile = currentIdentityProfileResponse.data.length == 1 ? currentIdentityProfileResponse.data[0] : null;
    if (currentTargetIdentityProfile) {
        winston.info(`Updating existing identity profile: ${localIdentityProfile.self.name} (${currentTargetIdentityProfile.self.id})`);
        //Restore attributes from the currently deployed target identity profile into our template transform
        for (const key of identityProfileExistingAttributeToKeep) {
            _.set(localIdentityProfile, key, _.get(currentTargetIdentityProfile, key));
        }
    } else {
        winston.info(clc.bgBlueBright(`Creating new identity profile: ${localIdentityProfile.self.name}`));
    }

    //Looks up owner identity by tokenized alias
    if (localIdentityProfile.object.owner) {
        const targetOwner = await getIdentityByAlias(apiConfig, localIdentityProfile.object.owner.name);
        localIdentityProfile.object.owner.id = targetOwner.id;
    }

    //Lookup target source. The source name in identity profiles is the backend app name with [source]
    const sourceLookupName = localIdentityProfile.object.authoritativeSource.name.replaceAll(" [source]", "").trim();
    const targetSourceResponse = await sourcesApi.listSources({
        filters: `name eq "${sourceLookupName}"`,
        limit: 1
    }).catch(error => {
        handleHttpException(error);
    });

    let currentTargetSource = targetSourceResponse.data.length == 1 ? targetSourceResponse.data[0] : null;

    //If the source does not exist, we need to create at least a shell source so schemas, etc. can reference it
    if (!currentTargetSource) throw new Error(`Cannot find authoritative source [${sourceLookupName}] for Identity Profile [${localIdentityProfile.self.name}] in target environment`);
    localIdentityProfile.object.authoritativeSource.id = currentTargetSource.id;


    //Iterate each identity attribute mapping and update references
    for (let attributeMapping of localIdentityProfile.object.identityAttributeConfig.attributeTransforms) {
        let transformDefinition = attributeMapping.transformDefinition;
        const transformDefinitonType = transformDefinition.type;

        if (transformDefinitonType === "accountAttribute" || transformDefinitonType === "reference") {
            //Looks for accountAttribute source first, if not truthy, assumes it's a transform reference and dives deeper for source reference
            const mappingSourceName = !!transformDefinition.attributes.sourceName ? transformDefinition.attributes.sourceName : transformDefinition.attributes.input.attributes.sourceName;
            const mappingSourceResponse = await sourcesApi.listSources({
                filters: `name eq "${mappingSourceName}"`,
                limit: 1
            }).catch(error => {
                handleHttpException(error);
            });
            let currentMappingSource = mappingSourceResponse.data.length == 1 ? mappingSourceResponse.data[0] : null;
            if (!currentMappingSource) throw new Error(`Cannot find source [${mappingSourceName}] for attribute mapping [${attributeMapping.identityAttributeName}] for Identity Profile [${localIdentityProfile.self.name}] in target environment`);

            //Update source ID reference
            if (transformDefinitonType === "accountAttribute") {
                attributeMapping.transformDefinition.attributes.sourceId = currentMappingSource.id;
            } else if (transformDefinitonType === "reference") {
                attributeMapping.transformDefinition.attributes.input.attributes.sourceId = currentMappingSource.id;
            }

        } else if (transformDefinitonType === "rule") {
            const ruleName = transformDefinition.attributes.name;

            //OOTB rules don't export so we we might not always find these, but name just name reference seems to work here 
            for (const rule of rules) {
                if (rule.self.name === ruleName) {
                    attributeMapping.transformDefinition.attributes.id = rule.self.id;
                }
            }
        }
    }

    /*
     * Current Identity Profile endpoints only support a single "import" as opposed to create vs update
     * so we will just run the import process whether it is a new object (no existing id references) or 
     * an existing object (existing id references). This also basically seems to be a special SP-Config
     * endpoint based on the format of the exported/imported objects. This is also why the input body below
     * is wrapped in an array containing the identity profile (since sp-config import expects this)
    */
    let importResponse;
    try {
        importResponse = await identityProfilesApi.importIdentityProfiles({
            identityProfileExportedObject: [
                localIdentityProfile
            ]
        });

        if (importResponse.data.errors.length > 0) {
            winston.error(clc.red(JSON.stringify(importResponse.data, null, 4)));
            process.exit(1);
        }

    } catch (error) {
        await handleHttpException(error);
    }

    //We need to fetch it now since it's not returned in the response
    try {
        currentIdentityProfileResponse = await identityProfilesApi.exportIdentityProfiles({
            filters: `name eq "${localIdentityProfile.object.name}"`
        })
        currentTargetIdentityProfile = currentIdentityProfileResponse.data.length == 1 ? currentIdentityProfileResponse.data[0] : null;
        if (currentTargetIdentityProfile == null) {
            winston.error(clc.red(`Could not fetch identity profile by name [${localIdentityProfile.object.name}] after create/update`));
            process.exit(1);
        }
    } catch (error) {
        await handleHttpException(error);
    }

    //If the initial profile is created/updated OK, move onto lifecycle states tied to it
    //Read directly from build directly for now instead of param passed in
    const localLifecycleStateFileNames = walk(`./build/config/IDENTITY_PROFILE/${localIdentityProfile.self.name}/LIFECYCLE_STATE`);
    if (localLifecycleStateFileNames && currentTargetIdentityProfile) {
        const lifecycleStateApi = new LifecycleStatesApi(apiConfig);

        //Get current lifecycle states if any
        const currentTargetLifecycleStatesResponse = await lifecycleStateApi.getLifecycleStates({
            identityProfileId: currentTargetIdentityProfile.self.id
        }).catch(error => {
            handleHttpException(error);
        });

        //Iterate each local, check if it exists in remote, and create/update accordingly
        for (const localLifecycleStateFileName of localLifecycleStateFileNames) {
            let localLifecycleState = JSON.parse(fs.readFileSync(localLifecycleStateFileName, { encoding: "utf8" }));

            /*
            * Need to do a lookup on access profiles and sources if configured
            * When they are exported, we replace IDs with names, so we will try
            * to find the same object by name in the target environment and get it's id
            */
            let accessProfileIds = [];
            if (localLifecycleState.accessProfileIds && localLifecycleState.accessProfileIds.length > 0) {
                for (const accessProfileName of localLifecycleState.accessProfileIds) {
                    const targetAccessProfile = await getAccessProfileByName(apiConfig, accessProfileName);
                    accessProfileIds.push(targetAccessProfile.id);
                }
                localLifecycleState.accessProfileIds = accessProfileIds;
            }

            let enableSourceIds = [];
            let disableSourceIds = [];
            if (localLifecycleState.accountActions && localLifecycleState.accountActions.length > 0) {
                let actions = [];
                for (const accountAction of localLifecycleState.accountActions) {
                    if (accountAction.action === "ENABLE") {
                        for (const sourceName of accountAction.sourceIds) {
                            const targetSource = await getSourceByName(apiConfig, sourceName);
                            enableSourceIds.push(targetSource.id);
                        }
                        actions.push(
                            {
                                "action": "ENABLE",
                                "sourceIds": enableSourceIds
                            }
                        )
                    } else if (accountAction.action === "DISABLE") {
                        for (const sourceName of accountAction.sourceIds) {
                            const targetSource = await getSourceByName(apiConfig, sourceName);
                            disableSourceIds.push(targetSource.id);
                        }
                        actions.push(
                            {
                                "action": "DISABLE",
                                "sourceIds": disableSourceIds
                            }
                        )
                    }
                }
                localLifecycleState.accountActions = actions;
            }

            let existsInTarget = false;
            if (currentTargetLifecycleStatesResponse.data) {
                for (const currentTargetLifecycleState of currentTargetLifecycleStatesResponse.data) {
                    if (currentTargetLifecycleState.name === localLifecycleState.name) {
                        existsInTarget = true;

                        //Restore attributes from the currently deployed target lifecycle state into our template transform
                        for (const key of lifecycleStateExistingAttributeToKeep) {
                            _.set(localLifecycleState, key, _.get(currentTargetLifecycleState, key));
                        }

                        //Need to build carefully since it will not accept empty arrays, etc.
                        //Initialize with emailNotificationOption, enabled, identityState
                        const patchOperations = [
                            {
                                op: "replace",
                                path: "/emailNotificationOption",
                                value: localLifecycleState.emailNotificationOption
                            },
                            {
                                op: "replace",
                                path: "/enabled",
                                value: localLifecycleState.enabled
                            },
                            {
                                op: "replace",
                                path: "/identityState",
                                value: localLifecycleState.identityState
                            }
                        ];

                        if (localLifecycleState.description) {
                            patchOperations.push(
                                {
                                    op: "replace",
                                    path: "/description",
                                    value: localLifecycleState.description
                                }
                            )
                        }

                        if (accessProfileIds.length > 0) {
                            patchOperations.push(
                                {
                                    op: "replace",
                                    path: "/accessProfileIds",
                                    value: accessProfileIds
                                }
                            )
                        }

                        if (enableSourceIds.length > 0 || disableSourceIds.length > 0) {
                            let accountOperations = [];
                            if (enableSourceIds.length > 0) {
                                accountOperations.push(
                                    {
                                        "action": "ENABLE",
                                        "sourceIds": enableSourceIds
                                    }
                                )
                            }
                            if (disableSourceIds.length > 0) {
                                accountOperations.push(
                                    {
                                        "action": "DISABLE",
                                        "sourceIds": disableSourceIds
                                    }
                                )
                            }
                            patchOperations.push(
                                {
                                    op: "replace",
                                    path: "/accountActions",
                                    value: accountOperations
                                }
                            );
                        }

                        //Update lifecycle state
                        try {
                            winston.info(`Updating existing lifecycle state: ${currentTargetLifecycleState.name} (${currentTargetLifecycleState.id})`)
                            await lifecycleStateApi.updateLifecycleStates({
                                identityProfileId: currentTargetIdentityProfile.self.id,
                                lifecycleStateId: currentTargetLifecycleState.id,
                                jsonPatchOperation: patchOperations
                            });
                        } catch (error) {
                            await handleHttpException(error);
                        }
                    }
                }
            }
            if (!existsInTarget) {
                winston.info(`Creating new lifecycle state: ${localLifecycleState.name})`)
                try {
                    const createLifecycleStateResponse = await lifecycleStateApi.createLifecycleState({
                        identityProfileId: currentTargetIdentityProfile.self.id,
                        lifecycleState: localLifecycleState
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            }
        }
    }
}

const migrateIdentityProfiles = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Identity Profile Deployment"));
    //Only read one directory down where main source files are
    const identityProfileFilePaths = walk("./build/config/IDENTITY_PROFILE", 1);

    //Iterate each source and pass it to migrateSource
    for (const identityProfileFilePath of identityProfileFilePaths) {
        const identityProfile = fs.readFileSync(identityProfileFilePath);
        await migrateIdentityProfile(apiConfig, identityProfile);
    }
    winston.info(clc.bgGreen("Completed Identity Profile Deployment"));
}

export {
    exportIdentityAttributeConfig,
    exportIdentityProfiles,
    migrateIdentityAttributeConfig,
    migrateIdentityProfile,
    migrateIdentityProfiles
};

