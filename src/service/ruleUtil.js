import * as fs from "fs";
import { writeConfigFile } from "../util.js";
import { runExport } from "./../util.js";

const RULE = "RULE";

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

const exportRules = async (apiConfig) => {
    const rules = await getAllRules(apiConfig);
    for (const rule of rules) {
        writeConfigFile(RULE, rule.self.name, rule);

        //Write separate txt file with source code for easy reference
        const source = rule.object.sourceCode.script;
        const ruleSourceFileName = `./config/RULE/${rule.self.name}.source.txt`;
        fs.writeFileSync(ruleSourceFileName, unescape(source), null, 4);
    }
}

export {
    exportRules, getAllRules
};
