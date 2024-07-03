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
    const accessProfileResponse = await accessProfilesApi.listAccessProfiles({
        filters: `name eq "${accessProfileName}"`,
        limit: 1
    });

    const accessProfile = accessProfileResponse.data.length == 1 ? accessProfileResponse.data[0] : null;

    if (!accessProfile) throw new Error(`Could not find access profile by name [${accessProfileName}] in tenant: ${apiConfig.basePath}`);
    return accessProfile;
}

export {
    getAccessProfileById,
    getAccessProfileByName
};