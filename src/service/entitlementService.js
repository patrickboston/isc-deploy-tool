import { EntitlementsV2025Api } from "sailpoint-api-client";
import { getSourceByName } from "./sourceService.js";

const getEntitlementById = async (apiConfig, entitlementId) => {
    const entitlementsApi = new EntitlementsV2025Api(apiConfig);
    const entitlement = await entitlementsApi.getEntitlement({
        id: entitlementId,
    });

    if (!entitlement.data) {
        throw new Error(`Could not find an Entitlement for id [${entitlementId}] in tenant: ${apiConfig.basePath}`);
    }

    return entitlement.data;
};

const getEntitlementByName = async (apiConfig, sourceName, entitlementName, value, attribute) => {
    var filters = [];
    if (sourceName != null && sourceName !== "IdentityNow") {
        const source = await getSourceByName(apiConfig, sourceName);
        filters.push(`source.id eq "${source.id}"`);
    }

    if (entitlementName != null) {
        filters.push(`name eq "${entitlementName}"`);
    }

    if (value != null) {
        filters.push(`value eq "${value}"`);
    }

    if (attribute != null) {
        filters.push(`attribute eq "${attribute}"`);
    }
    const entitlementsApi = new EntitlementsV2025Api(apiConfig);
    var entitlementResponse = await entitlementsApi.listEntitlements({
        filters: filters.join(" and "),
        limit: 1,
    });

    const entitlement = entitlementResponse.data.length == 1 ? entitlementResponse.data[0] : null;

    if (!entitlement) {
        throw new Error(
            `Could not find entitlement by sourceName [${sourceName}], entitlementName [${entitlementName}], value [${value}], and attribute [${attribute}] in tenant: ${apiConfig.basePath}`
        );
    }
    return entitlement;
};

export { getEntitlementById, getEntitlementByName };
