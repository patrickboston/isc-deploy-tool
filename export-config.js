export default
    {
        "omitProperties": {
            "ACCESS_REQUEST_CONFIG": [
                "$.approvalReminderAndEscalationConfig.fallbackApproverRef.id"
            ],
            "ATTR_SYNC_SOURCE_CONFIG": [
                "$.source.id"
            ],
            "BRANDING_CONFIG": [
                "$.[*].standardLogoURL"
            ],
            "CONNECTOR_SCHEMA": [
                "$.attributes[*].schema.id"
            ],
            "GLOBAL": [
                "$.id",
                "$.created",
                "$.modified"
            ],
            "GOVERNANCE_GROUP": [
                "$.owner.id"
            ],
            "IDENTITY_PROFILE": [
                "$.self.id",
                "$.object.id",
                "$.object.created",
                "$.object.modified",
                "$.object.owner.id",
                "$.object.authoritativeSource.id",
                "$.object.identityAttributeConfig.attributeTransforms[?(@.transformDefinition.type == 'rule')].transformDefinition.attributes.id",
                "$.object.identityAttributeConfig.attributeTransforms[?(@.transformDefinition.type == 'reference')].transformDefinition.attributes.input.attributes.sourceId",
                "$.object.identityAttributeConfig.attributeTransforms[?(@.transformDefinition.type == 'accountAttribute')].transformDefinition.attributes.sourceId",
                "$.object.identityCount"
            ],
            "PASSWORD_POLICY": [
                "$.dateCreated",
                "$.lastUpdated"
            ],
            "SERVICE_DESK_INTEGRATION": [
                "$.ownerRef.id",
                "$.clusterRef.id",
                "$.provisioningConfig.managedResourceRefs[*].id",
                "$.beforeProvisioningRule.id"
            ],
            "SOURCE": [
                "$.owner.id",
                "$.cluster.id",
                "$.accountCorrelationConfig.id",
                "$.accountCorrelationRule.id",
                "$.managerCorrelationRule.id",
                "$.beforeProvisioningRule.id",
                "$.schemas[*].id",
                "$.passwordPolicies[*].id",
                "$.connectorAttributes.cloudExternalId",
                "$.connectorAttributes.slpt-source-diagnostics",
                "$.connectorAttributes.cloudCacheUpdate",
                "$.connectorAttributes.deltaAggregation",
                "$.status",
                "$.since",
                "$.healthy"
            ],
            "WORKFLOW": [
                "$.modifiedBy",
                "$.creator",
                "$.owner.id"
            ]
        }
    }