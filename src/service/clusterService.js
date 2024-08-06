import { ManagedClustersApi } from "sailpoint-api-client";

const getAllClusters = async (apiConfig) => {
    const clusterApi = new ManagedClustersApi(apiConfig);
    
    const clusterResponse = await clusterApi.getManagedClusters();

    if (!clusterResponse || clusterResponse.data.length === 0) {
        throw new Error(`Could not find any VA clusters for tenant: ${apiConfig.basePath}. A VA Cluster is required for sources and service desk integrations`)
    }

    return clusterResponse.data;
}

export {
    getAllClusters
};