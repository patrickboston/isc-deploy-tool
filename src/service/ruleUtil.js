import clc from "cli-color";
import * as fs from "fs";
import winston from "winston";
import { writeConfigFile } from "../util.js";
import { runExport } from "./../util.js";

const RULE = "RULE";
let ruleCache;

const getAllRules = async (apiConfig) => {
    if (ruleCache) return ruleCache;

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
    ruleCache = rulesResponse;
    return rulesResponse;
}

const exportRules = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Rule Export"));
    const rules = await getAllRules(apiConfig);
    for (const rule of rules) {
        winston.info(`Exporting Rule: ${rule.self.name} (${rule.self.id})`);
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

