import { AccessProfilesApi } from "sailpoint-api-client";

const getAccessProfileById = async (apiConfig, accessProfileId) => {
    const accessProfilesApi = new AccessProfilesApi(apiConfig);
    const accessProfile = await accessProfilesApi.getAccessProfile({
        id: accessProfileId
    });

    if (!accessProfile.data) {
        throw new Error(`Could not find an Access Profile for id [${accessProfileId}] in tenant: ${apiConfig.basePath}`)
    }

    return accessProfile.data;
}

const getAccessProfileByName = async (apiConfig, accessProfileName) => {
    const accessProfilesApi = new AccessProfilesApi(apiConfig);
    const accessProfile = await accessProfilesApi.listAccessProfiles({
        filters: `name eq "${accessProfileName}"`
    });

    if (!accessProfile.data) {
        throw new Error(`Could not find an Access Profile for name [${accessProfileName}] in tenant: ${apiConfig.basePath}`)
    }

    return accessProfile.data;
}

export {
    getAccessProfileById,
    getAccessProfileByName
};