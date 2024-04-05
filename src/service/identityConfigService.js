import clc from "cli-color";
import { IdentityAttributesBetaApi, IdentityProfilesApi } from "sailpoint-api-client";
import { writeConfigFile } from "../util.js";

const IDENTITY_OBJECT_CONFIG = "IDENTITY_OBJECT_CONFIG";
const IDENTITY_PROFILE = "IDENTITY_PROFILE";

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
    const identityProfiles = await identityProfilesApi.listIdentityProfiles();
    for (const profile of identityProfiles.data) {
        writeConfigFile(IDENTITY_PROFILE, profile.name, profile);
    }
}

export {
    exportIdentityAttributeConfig,
    exportIdentityProfiles
};