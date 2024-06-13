import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { IdentityAttributesBetaApi, IdentityProfilesApi, LifecycleStatesApi, SourcesApi } from "sailpoint-api-client";
import { handleHttpException, walk, writeConfigFile } from "../util.js";
import { getAccessProfileById, getAccessProfileByName } from "./accessProfileUtil.js";
import { getIdentityByAlias, getIdentityById } from "./identityUtil.js";
import { getAllRules } from "./ruleUtil.js";
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
    console.info(clc.bgBlueBright("Performing Identity Object Config export"));
    const identityAttributesApi = new IdentityAttributesBetaApi(apiConfig);
    const identityAttributeConfig = await identityAttributesApi.listIdentityAttributes();
    writeConfigFile(IDENTITY_OBJECT_CONFIG, IDENTITY_OBJECT_CONFIG, identityAttributeConfig.data);
};

const exportIdentityProfiles = async (apiConfig) => {
    console.info(clc.bgBlueBright("Performing Identity Profiles export"));
    const identityProfilesApi = new IdentityProfilesApi(apiConfig);
    const lifecycleStatesApi = new LifecycleStatesApi(apiConfig);
    const identityProfiles = await identityProfilesApi.exportIdentityProfiles();
    for (let profile of identityProfiles.data) {
        //Update owner to alias for lookup when migrating, default IDN Admin won't have owner
        if (profile.object.owner) {
            const owner = await getIdentityById(apiConfig, profile.object.owner.id);
            profile.object.owner.name = owner.alias;
        }

        //Lifecycle states are attached to Identity Profiles so let's grab them
        const lifecycleStatesResponse = await lifecycleStatesApi.listLifecycleStates({
            identityProfileId: profile.self.id
        });
        if (lifecycleStatesResponse.data) {
            for (let lifecycleState of lifecycleStatesResponse.data) {
                //TODO: Replace IDs of sources to enable/disable with source names AND accessProfileIds
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

const migrateIdentityAttributeConfig = async (apiConfig, identityAttrConfigJson) => {
    console.log(clc.bgBlueBright(`Migrating Identity Attribute Configuration`));
    const identityAttributesApi = new IdentityAttributesBetaApi(apiConfig);

    //Differs from other objects as we need to iterate each attribute in the array of attributes
    let localIdentityAttributeConfig = JSON.parse(identityAttrConfigJson);
    for (const localIdentityAttribute of localIdentityAttributeConfig) {
        console.log(clc.bgBlueBright(`Updating Identity Attribute: ${localIdentityAttribute.name}`));

        //Check and see if a identity attribute with this name already exists in the target environment
        let currentTargetIdentityAttribute;
        try {
            const currentIdentityAttributeResponse = await identityAttributesApi.getIdentityAttribute({
                name: localIdentityAttribute.name
            });
            currentTargetIdentityAttribute = currentIdentityAttributeResponse.data;
        } catch (error) {
            if (error.response.status === 404) {
                console.log(`Identity Attribute [${localIdentityAttribute.name}] does not exist yet`);
            }
        }

        if (!currentTargetIdentityAttribute) {
            console.log(clc.bgBlueBright(`Creating new Identity Attribute for: ${localIdentityAttribute.name}`));
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
            console.log(`Found existing Identity Attribute Config in target environment: ${currentTargetIdentityAttribute.name}`)

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

const migrateIdentityProfile = async (apiConfig, identityProfileJson) => {
    const identityProfilesApi = new IdentityProfilesApi(apiConfig);
    const sourcesApi = new SourcesApi(apiConfig);

    let localIdentityProfile = JSON.parse(identityProfileJson);
    console.log(clc.bgBlueBright(`Migrating identity profile: ${localIdentityProfile.self.name}`));

    //Get all rules incase we need to perform a lookup
    const rules = await getAllRules(apiConfig);

    //Check and see if an identity profile with this name already exists in the target environment
    const currentIdentityProfileResponse = await identityProfilesApi.exportIdentityProfiles({
        filters: `name eq "${localIdentityProfile.object.name}"`
    });
    let currentTargetIdentityProfile = currentIdentityProfileResponse.data.length == 1 ? currentIdentityProfileResponse.data[0] : null;
    if (currentTargetIdentityProfile) {
        //Restore attributes from the currently deployed target identity profile into our template transform
        for (const key of identityProfileExistingAttributeToKeep) {
            _.set(localIdentityProfile, key, _.get(currentTargetIdentityProfile, key));
        }
    }

    //Looks up owner identity by tokenized alias
    const targetOwner = await getIdentityByAlias(apiConfig, localIdentityProfile.object.owner.name);
    localIdentityProfile.object.owner.id = targetOwner.id;

    //Lookup target source. The source name in identity profiles is the backend app name with [source]
    const sourceLookupName = localIdentityProfile.object.authoritativeSource.name.replaceAll(" [source]", "").trim();
    const targetSourceResponse = await sourcesApi.listSources({
        filters: `name eq "${sourceLookupName}"`,
        limit: 1
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
    } catch (error) {
        await handleHttpException(error);
    }

    //Since this is sp-config import, we need to check for errors manually in the body
    if (importResponse.data.errors.length > 0) {
        console.error(clc.red(JSON.stringify(importResponse.data, null, 4)));
    }

    //If the initial profile is created/updated OK, move onto lifecycle states tied to it
    //Read directly from build directly for now instead of param passed in
    const localLifecycleStateFileNames = walk(`./build/config/IDENTITY_PROFILE/${localIdentityProfile.self.name}/LIFECYCLE_STATE`);
    if (localLifecycleStateFileNames) {
        const lifecycleStateApi = new LifecycleStatesApi(apiConfig);

        //Get current lifecycle states if any
        const currentTargetLifecycleStatesResponse = await lifecycleStateApi.listLifecycleStates({
            identityProfileId: currentTargetIdentityProfile.self.id
        });

        //Iterate each local, check if it exists in remote, and create/update accordingly
        for (const localLifecycleStateFileName of localLifecycleStateFileNames) {
            let localLifecycleState = JSON.parse(fs.readFileSync(localLifecycleStateFileName, { encoding: "utf8" }));
            console.log(`Checking local LCS: ${localLifecycleState.name}`);

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
                        console.log(`Found a match in the target: ${currentTargetLifecycleState.name}`);
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
                try {
                    await lifecycleStateApi.createLifecycleState({
                        identityProfileId: currentTargetIdentityProfile.self.id,
                        lifecycleState: localLifecycleState
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            } else {
                console.log("Already existed and updated, no need to create");
            }
        }
    }
}

export {
    exportIdentityAttributeConfig,
    exportIdentityProfiles,
    migrateIdentityAttributeConfig,
    migrateIdentityProfile
};

