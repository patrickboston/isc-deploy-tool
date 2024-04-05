import { runExport } from "./../util.js";

const getAllRules = async (apiConfig) => {
    const ruleExportConfig = {
        "excludeTypes": [
        ],
        "includeTypes": [
            "RULE"
        ],
        "objectOptions": {
        }
    }

    const rulesResponse = await runExport(apiConfig, ruleExportConfig);
    return rulesResponse;
}

export {
    getAllRules
};