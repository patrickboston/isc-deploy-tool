export default {
    "SOURCE/Active Directory/Active Directory.json": {
        "$.owner.name": "%%AD_OWNER_ALIAS%%",
        "$.connectorAttributes.IQServicePort": "%%AD_IQSERVICE_PORT%%",
        "$.connectorAttributes[group.searchDNs][0].searchDN": "%%AD_BASE_DN%%",
    },
};
