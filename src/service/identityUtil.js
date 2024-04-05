import { IdentitiesBetaApi } from "sailpoint-api-client";

const getIdentityByName = async (apiConfig, identityName) => {
    const identityApi = new IdentitiesBetaApi(apiConfig);
    const identityResponse = await identityApi.listIdentities({
        filters: `name eq "${identityName}"`,
        defaultFilter: "NONE" //Show hidden SailPoint identities
    });

    if (!identityResponse || identityResponse.data.length === 0) {
        throw new Error(`Could not find identity for name ${identityName} in tenant: ${apiConfig.basePath}`)
    }

    return identityResponse.data[0];
}

export {
    getIdentityByName
};