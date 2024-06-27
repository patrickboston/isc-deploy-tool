#!/usr/bin/env node
import axiosRetry from "axios-retry";
import clc from "cli-color";
import * as fs from "fs";
import { Configuration } from "sailpoint-api-client";
import winston from "winston";
import { exportAccessRequestConfig } from "./service/accessRequestUtil.js";
import { exportIdentityAttributeConfig, exportIdentityProfiles, migrateIdentityAttributeConfig, migrateIdentityProfiles } from "./service/identityConfigService.js";
import { exportGovernanceGroups } from "./service/identityUtil.js";
import { exportNotificationTemplates } from "./service/notificationUtil.js";
import { exportRules, migrateRules } from "./service/ruleUtil.js";
import { exportSources, migrateSources } from "./service/sourceService.js";
import { exportTransforms, migrateTransforms } from "./service/transformUtil.js";
import { exportWorkflows, migrateWorkflows } from "./service/workflowUtil.js";
import { buildObjectsForEnvironment, reverseTokenize, runExport } from "./util.js";

const results = [];
const nodeArgs = (argList => {
    const args = {};

    for (let c = 0, n = argList.length; c < n; c++) {
        const thisOpt = argList[c].trim();
        let opt = thisOpt.replace(/^\-+/, '');
        let curOpt;

        if (opt === thisOpt) {
            if (curOpt) args[curOpt] = opt;
            curOpt = null;
        } else {
            if (~opt.indexOf('=')) {
                opt = opt.split('=');
                curOpt = opt[0];
                opt = opt.slice(1).join('=');
                args[curOpt] = opt;
            } else {
                curOpt = opt;
                args[curOpt] = true;
            }
        }
    }

    return args;
})(process.argv);

//Input cmd args
let {
    export: isExport,
    build: isBuild,
    deploy: isDeploy,
    detokenize: isDetokenize,
    src_env: srcEnvName,
    target_env: targetEnvName,
    log_level: logLevel
} = nodeArgs;

//Logger
const logFormat = winston.format.printf(({ level, message, label, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});
winston.configure({
    level: logLevel || "info",
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.cli(),
        winston.format.timestamp({format: "YYYY-MM-DD HH:mm:ss"}),
        logFormat
    ),
    transports: [
        new winston.transports.Console()
    ]
});

//Process args
srcEnvName = srcEnvName && srcEnvName.toLowerCase();
targetEnvName = targetEnvName && targetEnvName.toLowerCase();

winston.info(clc.bgBlueBright("SailPoint IDN Migration Tool"));

//Check export params
if (isExport && !srcEnvName) {
    winston.error(clc.bgRed("FAILED: --src_env argument is required for export but was not supplied, exiting"));
    process.exit(1);
} else if (isExport) {
    winston.info(clc.bgMagentaBright(`Running with src_env: ${srcEnvName}`));
}

//Check build params
if (isBuild && !targetEnvName) {
    winston.error(clc.bgRed("FAILED: --target_env argument is required for build but was not supplied, exiting"));
    process.exit(1);
} else if (isBuild) {
    winston.info(clc.bgMagentaBright(`Running build with target_env: ${targetEnvName}`));
}

//Check deploy params
if (isDeploy && (!targetEnvName)) {
    winston.error(clc.bgRed("FAILED: --target_env argument is required for deploy but was not supplied, exiting"));
    process.exit(1);
} else if (isDeploy) {
    winston.info(clc.bgMagentaBright(`Running deploy with target_env: ${targetEnvName}`));
}

//Cleanup build directory
fs.rmSync("./build", { recursive: true, force: true });

//Perform export setup and process
if (isExport) {
    //Set up config based on envirnments
    const { default: srcEnvParams } = await import("./../" + srcEnvName + ".env.js");

    let srcApiConfig = new Configuration(srcEnvParams);
    srcApiConfig.retriesConfig = {
        retries: 2,
        retryDelay: axiosRetry.exponentialDelay,
        onRetry(retryCount, error, requestConfig) {
            winston.info(clc.yellow(`Retrying due to request error, try number ${retryCount}`));
        }
    }

    if (isExport && isDetokenize) {
        winston.info(clc.bgMagentaBright("Running export and de-tokenization..."));

        await exportRules(srcApiConfig);
        await exportTransforms(srcApiConfig);
        await exportSources(srcApiConfig);
        await exportIdentityAttributeConfig(srcApiConfig);
        await exportIdentityProfiles(srcApiConfig);
        await exportAccessRequestConfig(srcApiConfig);
        await exportNotificationTemplates(srcApiConfig);
        await exportWorkflows(srcApiConfig);
        await exportGovernanceGroups(srcApiConfig);

        //Perform reverse tokenization on all exported files
        await reverseTokenize();

    } else if (isExport && !isDetokenize) {
        winston.info(clc.bgMagentaBright("Running raw export WITHOUT de-tokenization"));
        await runExport(srcApiConfig);
    }
}

//Perform local build only
if (isBuild) {
    await buildObjectsForEnvironment(targetEnvName);
}

//Perform deploy setup and process
if (isDeploy) {
    const { default: targetEnvParams } = await import("./../" + targetEnvName + ".env.js");

    let targetApiConfig = new Configuration(targetEnvParams);
    targetApiConfig.retriesConfig = {
        retries: 2,
        retryDelay: (retryCount) => {
            console.log(`retry attempt: ${retryCount}`);
            return retryCount * 20000;
        },
        onRetry(retryCount, error, requestConfig) {
            winston.warn(clc.yellow(`Retrying due to request error, try number ${retryCount}`));
        },
        retryCondition: (error) => {
            // here is your mistake. check for error config you want to retry
            return error.response.status === 429;
        },
    }
    
    //Perform tokenization
    await buildObjectsForEnvironment(targetEnvName);

    /**
     * Objects need to be migrated in a specific order for reference sake. That order is:
     * 1. Rules (Connector + Already Approved Cloud)
     * 2. Transforms
     * 3. Sources
     * 4. Identity Object Config
     * 5. Identity Profile (including Lifecycle States)
     * 6. Workflow
    */

    //await migrateRules(targetApiConfig);
    //await migrateTransforms(targetApiConfig);
    await migrateSources(targetApiConfig);
    await migrateIdentityAttributeConfig(targetApiConfig);
    await migrateIdentityProfiles(targetApiConfig);
    await migrateWorkflows(targetApiConfig);
}


process.exit(0);