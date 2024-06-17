import { ManagedClustersBetaApi } from "sailpoint-api-client";
import winston from "winston";

const getAllClusters = async (apiConfig) => {
    const clusterApi = new ManagedClustersBetaApi(apiConfig);
    const clusterResponse = await clusterApi.getManagedClusters();

    if (!clusterResponse || clusterResponse.data.length === 0) {
        throw new Error(`Could not find any VA Cluster for tenant: ${apiConfig.basePath}`)
    }

    return clusterResponse.data;
}

export {
    getAllClusters
};