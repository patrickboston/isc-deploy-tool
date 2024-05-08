import { AccessRequestsApi } from "sailpoint-api-client";
import { writeConfigFile } from "../util.js";

const ACCESS_REQUEST_CONFIG = "ACCESS_REQUEST_CONFIG";

const exportAccessRequestConfig = async (apiConfig) => {
    const accessRequestApi = new AccessRequestsApi(apiConfig);
    const accessRequestConfigResponse = await accessRequestApi.getAccessRequestConfig();
    writeConfigFile(ACCESS_REQUEST_CONFIG, ACCESS_REQUEST_CONFIG, accessRequestConfigResponse.data);
}

const updateAccessRequestConfig = async (apiConfig, newAccessRequestConfig) => {
    const accessRequestApi = new AccessRequestsApi(apiConfig);

    //TODO: Do fallback approver lookup and set for target env
    //TODO: Workgroup/governance group looksups for approvals (i.e. "grantRequestApprovalSchemes": "entitlementOwner,workgroup: cf45f919-8b05-4848-87e1-10270704a495"))

    const accessRequestConfigResponse = await accessRequestApi.setAccessRequestConfig({
        accessRequestConfig: newAccessRequestConfig
    });
}

export {
    exportAccessRequestConfig
};