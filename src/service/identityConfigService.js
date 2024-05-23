import clc from "cli-color";
import _ from 'lodash';
import { IdentityAttributesBetaApi, IdentityProfilesApi, SourcesApi } from "sailpoint-api-client";
import { getIdentityByAlias, getIdentityById } from "./identityUtil.js";
import { getAllRules } from "./ruleUtil.js";
import { writeConfigFile } from "../util.js";

const IDENTITY_OBJECT_CONFIG = "IDENTITY_OBJECT_CONFIG";
const IDENTITY_PROFILE = "IDENTITY_PROFILE";
const existingAttributeToKeep = [
    "object.id", "self.id"
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
    const identityProfiles = await identityProfilesApi.exportIdentityProfiles();
    for (let profile of identityProfiles.data) {
        //Update owner to alias for lookup when migrating, default IDN Admin won't have owner
        if (profile.object.owner) {
            const owner = await getIdentityById(apiConfig, profile.object.owner.id);
            profile.object.owner.name = owner.alias;
        }

        //This is basically using SP-Config in the backend so we need to reference self.name here
        writeConfigFile(IDENTITY_PROFILE, profile.self.name, profile);
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
        } else {
            console.log(`Found existing Identity Attribute Config in target environment: ${currentTargetIdentityAttribute.name}`)

            //Update the identity attribute with all config, references, etc.
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
        //Restore attributes from the currently deployed target transform into our template transform
        for (const key of existingAttributeToKeep) {
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
    const importResponse = await identityProfilesApi.importIdentityProfiles({
        identityProfileExportedObject: [
            localIdentityProfile
        ]
    });

    //Since this is sp-config import, we need to check for errors manually in the body
    if (importResponse.data.errors.length > 0) {
        throw new Error(JSON.stringify(importResponse.data, null, 4));
    }
}

export {
    exportIdentityAttributeConfig,
    exportIdentityProfiles,
    migrateIdentityAttributeConfig,
    migrateIdentityProfile
};