export default
    {
        "SOURCE/Active Directory/Active Directory.json": {
            "$.owner.name": "%%AD_OWNER_ALIAS%%",
            "$.connectorAttributes.IQServicePort": "%%AD_IQSERVICE_PORT%%",
            "$.notfound": "%%ABC%%"
        },
        "SOURCE/JAR TEST/JAR TEST.json": {
        },
        "ACCESS_REQUEST_CONFIG/ACCESS_REQUEST_CONFIG.json": {
            "$.approvalReminderAndEscalationConfig.fallbackApproverRef.name": "%%JAR_TEST_OWNER_ALIAS%%"
        }
    }