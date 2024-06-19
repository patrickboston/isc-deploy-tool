import clc from "cli-color";
import { AccessRequestsApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, writeConfigFile } from "../util.js";
import { getGovGroupById, getGovGroupByName, getIdentityByAlias, getIdentityById } from "./identityUtil.js";

const ACCESS_REQUEST_CONFIG = "ACCESS_REQUEST_CONFIG";

const exportAccessRequestConfig = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Access Request Configuration Export"));
    const accessRequestApi = new AccessRequestsApi(apiConfig);
    const accessRequestConfigResponse = await accessRequestApi.getAccessRequestConfig();
    let accessRequestConfig = accessRequestConfigResponse.data;

    //Update fallbackApproverRef.name to alias for lookup when migrating
    if (accessRequestConfig.approvalReminderAndEscalationConfig.fallbackApproverRef) {
        const owner = await getIdentityById(apiConfig, accessRequestConfig.approvalReminderAndEscalationConfig.fallbackApproverRef.id);
        accessRequestConfig.approvalReminderAndEscalationConfig.fallbackApproverRef.name = owner.alias;
    }

    //If there is a gov group approver, convert the id to the name so we can look it up in the next environment
    let grantRequestApprovalSchemes = accessRequestConfig.entitlementRequestConfig.grantRequestApprovalSchemes;
    if (grantRequestApprovalSchemes && grantRequestApprovalSchemes.includes("workgroup:")) {
        const startIndex = grantRequestApprovalSchemes.indexOf('workgroup:') + 'workgroup:'.length;
        const endIndex = grantRequestApprovalSchemes.indexOf(',', startIndex) !== -1 ? grantRequestApprovalSchemes.indexOf(',', startIndex) : grantRequestApprovalSchemes.length;
        const govGroupId = grantRequestApprovalSchemes.substring(startIndex, endIndex).trim();
        const govGroup = await getGovGroupById(apiConfig, govGroupId);
        grantRequestApprovalSchemes = grantRequestApprovalSchemes.replace(govGroupId, govGroup.name);
        accessRequestConfig.entitlementRequestConfig.grantRequestApprovalSchemes = grantRequestApprovalSchemes;
    }
    writeConfigFile(ACCESS_REQUEST_CONFIG, ACCESS_REQUEST_CONFIG, accessRequestConfigResponse.data);
}

const updateAccessRequestConfig = async (apiConfig, newAccessRequestConfig) => {
    let localAccessRequestConfig = JSON.parse(newAccessRequestConfig);
    const accessRequestApi = new AccessRequestsApi(apiConfig);
    //const currentTargetAccessRequestConfig = await accessRequestApi.getAccessRequestConfig();

    //If fallback approver exists, perform lookup
    let fallBackApproverRef = localAccessRequestConfig.approvalReminderAndEscalationConfig.fallbackApproverRef;
    if (fallBackApproverRef) {
        //Looks up fallback approver identity by tokenized alias
        const targetFallbackApprover = await getIdentityByAlias(apiConfig, fallBackApproverRef.name);

        //Update id and email reference incase it's different in target env
        fallBackApproverRef.id = targetFallbackApprover.id;
        fallBackApproverRef.email = targetFallbackApprover.email;
        localAccessRequestConfig.approvalReminderAndEscalationConfig.fallbackApproverRef = fallBackApproverRef;
    }

    //Workgroup/governance group looksups for approvals (i.e. "grantRequestApprovalSchemes": "entitlementOwner,workgroup: cf45f919-8b05-4848-87e1-10270704a495"))
    let grantRequestApprovalSchemes = localAccessRequestConfig.entitlementRequestConfig.grantRequestApprovalSchemes;
    if (grantRequestApprovalSchemes && grantRequestApprovalSchemes.includes("workgroup:")) {
        const startIndex = grantRequestApprovalSchemes.indexOf('workgroup:') + 'workgroup:'.length;
        const endIndex = grantRequestApprovalSchemes.indexOf(',', startIndex) !== -1 ? grantRequestApprovalSchemes.indexOf(',', startIndex) : grantRequestApprovalSchemes.length;
        const govGroupName = grantRequestApprovalSchemes.substring(startIndex, endIndex).trim();
        //During export, we store the gov group by name instead of ID, so we will look it up by name and replace with target id
        const govGroup = await getGovGroupByName(apiConfig, govGroupName);
        grantRequestApprovalSchemes = grantRequestApprovalSchemes.replace(govGroupName, govGroup.id);
        localAccessRequestConfig.entitlementRequestConfig.grantRequestApprovalSchemes = grantRequestApprovalSchemes;
    }

    try {
        const accessRequestConfigResponse = await accessRequestApi.setAccessRequestConfig({
            accessRequestConfig: localAccessRequestConfig
        });
    } catch (error) {
        await handleHttpException(error);
    }
}

export {
    exportAccessRequestConfig,
    updateAccessRequestConfig
};

