#!/usr/bin/env node
import clc from "cli-color";
import * as fs from "fs";
import { Configuration } from "sailpoint-api-client";
import winston from "winston";
import { exportAccessRequestConfig, updateAccessRequestConfig } from "./service/accessRequestService.js";
import { exportBranding, updateBranding } from "./service/brandingService.js";
import { exportIdentityAttributeConfig, exportIdentityProfiles, migrateIdentityAttributeConfig, migrateIdentityProfiles } from "./service/identityConfigService.js";
import { exportGovernanceGroups, migrateGovernanceGroups } from "./service/identityService.js";
import { exportNotificationTemplates, migrateNotificationTemplates } from "./service/notificationService.js";
import { exportPasswordPolicies, migratePasswordPolicies } from "./service/passwordPolicyService.js";
import { exportConnectorRules, exportCloudRules, migrateCloudRules, migrateConnectorRules } from "./service/ruleService.js";
import { exportServiceDeskIntegrations, migrateServiceDeskIntegrations } from "./service/serviceDeskIntegrationService.js";
import { exportSources, migrateSources } from "./service/sourceService.js";
import { exportTransforms, migrateTransforms } from "./service/transformService.js";
import { exportWorkflows, migrateWorkflows } from "./service/workflowService.js";
import { buildObjectsForEnvironment, reverseTokenize } from "./util.js";

const start = Date.now();

//Parse input args from cmd
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
    src_env: srcEnvName, //Source environment for export command
    target_env: targetEnvName, //Target environment for build/deploy commands
    log_level: logLevel, //Sets winston log level
    skip_connector_lib: isSkipConnectorLib //Allows you to skip connector file upload if arg is present
} = nodeArgs;

//Global winston logger
const logFormat = winston.format.printf(({ level, message, label, timestamp }) => {
    return `${timestamp} [${level}]: ${message}`;
});
winston.configure({
    level: logLevel || "info",
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.cli(),
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        logFormat
    ),
    transports: [
        new winston.transports.Console()
    ]
});

winston.info(clc.bgBlueBright("SailPoint ISC Deploy Tool"));

//Retry config for Axios
const globalRetryConfig = {
    retries: 2,
    retryDelay: (retryCount) => {
        return retryCount * 20000;
    },
    onRetry(retryCount, error, requestConfig) {
        winston.warn(clc.yellow(`ISC Rate limit reached, sleeping and retrying... (retry number ${retryCount})`));
    },
    retryCondition: (error) => {
        if (error.response) {
            return error.response.status === 429;
        }
    }
};

/**
 * Check environment variables for BASE_URL, TOKEN_URL, CLIENT_ID, and CLIENT_SECRET
 * If these exist, we will use these and ignore <env>.env.js files since we would are
 * preferring local env variables or using a pipeline process
*/
const BASE_URL = process.env.BASE_URL;
const TOKEN_URL = process.env.TOKEN_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
let globalApiConfiguration;
if (BASE_URL && TOKEN_URL && CLIENT_ID && CLIENT_SECRET) {
    winston.debug("Detected required environment variables, using those instead of env.js config file");
    globalApiConfiguration = new Configuration({
        baseurl: BASE_URL,
        tokenUrl: TOKEN_URL,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
    });
    globalApiConfiguration.retriesConfig = globalRetryConfig;

    //Make sure we have api in endpoints
    if (!globalApiConfiguration.tokenUrl.includes(".api.") || !globalApiConfiguration.basePath.includes(".api.")) {
        winston.error(clc.bgRed("FAILED: baseurl or tokenUrl provided does not contain .api. in the endpoint URI"));
        process.exit(1);
    }
}

//Process input args
srcEnvName = srcEnvName && srcEnvName.toLowerCase();
targetEnvName = targetEnvName && targetEnvName.toLowerCase();

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
if (isExport && isDetokenize) {
    winston.info(clc.bgMagentaBright("Running export and de-tokenization..."));

    if (!globalApiConfiguration) {
        const { default: srcEnvParams } = await import("./../" + srcEnvName + ".env.js");
        globalApiConfiguration = new Configuration(srcEnvParams);
        globalApiConfiguration.retriesConfig = globalRetryConfig;

        //Make sure we have api in endpoints
        if (!globalApiConfiguration.tokenUrl.includes(".api.") || !globalApiConfiguration.basePath.includes(".api.")) {
            winston.error(clc.bgRed("FAILED: baseurl or tokenUrl provided does not contain .api. in the endpoint URI"));
            process.exit(1);
        }
    }

    await exportGovernanceGroups(globalApiConfiguration);
    await exportPasswordPolicies(globalApiConfiguration);
    await exportCloudRules(globalApiConfiguration);
    await exportConnectorRules(globalApiConfiguration);
    await exportTransforms(globalApiConfiguration);
    await exportSources(globalApiConfiguration);
    await exportServiceDeskIntegrations(globalApiConfiguration);
    await exportIdentityAttributeConfig(globalApiConfiguration);
    await exportIdentityProfiles(globalApiConfiguration);
    await exportAccessRequestConfig(globalApiConfiguration);
    await exportNotificationTemplates(globalApiConfiguration);
    await exportWorkflows(globalApiConfiguration);
    await exportBranding(globalApiConfiguration);

    //Perform reverse tokenization on all exported files
    await reverseTokenize();
}


//Perform local build only
if (isBuild) {
    await buildObjectsForEnvironment(targetEnvName);
}

//Perform deploy setup and process
if (isDeploy) {

    if (!globalApiConfiguration) {
        const { default: targetEnvParams } = await import("./../" + targetEnvName + ".env.js");
        globalApiConfiguration = new Configuration(targetEnvParams);
        globalApiConfiguration.retriesConfig = globalRetryConfig;

        //Make sure we have api in endpoints
        if (!globalApiConfiguration.tokenUrl.includes(".api.") || !globalApiConfiguration.basePath.includes(".api.")) {
            winston.error(clc.bgRed("FAILED: baseurl or tokenUrl provided does not contain .api. in the endpoint URI"));
            process.exit(1);
        }
    }

    //Perform tokenization
    await buildObjectsForEnvironment(targetEnvName);

    /**
     * Objects need to be migrated in a specific order for reference sake. That order is:
     * 1. Governance Groups
     * 2. Password Policies
     * 3. Rules (Connector + Already Approved Cloud)
     * 4. Transforms
     * 5. Sources (dependencies on rules, transforms, password policies)
     * 6. Service Desk Integrations (dependencies on rules, sources)
     * 7. Identity Object Config (dependencies on sources, rules, transforms)
     * 8. Identity Profile (including Lifecycle States, dependencies on sources)
     * 9. Access Request Config
     * 10. Notification Template
     * 11. Workflow
     * 12. Branding
    */
    await migrateGovernanceGroups(globalApiConfiguration);
    await migratePasswordPolicies(globalApiConfiguration);
    await migrateCloudRules(globalApiConfiguration);
    await migrateConnectorRules(globalApiConfiguration)
    await migrateTransforms(globalApiConfiguration);
    await migrateSources(globalApiConfiguration, isSkipConnectorLib);
    await migrateServiceDeskIntegrations(globalApiConfiguration)
    await migrateIdentityAttributeConfig(globalApiConfiguration);
    await migrateIdentityProfiles(globalApiConfiguration);
    await updateAccessRequestConfig(globalApiConfiguration);
    await migrateNotificationTemplates(globalApiConfiguration);
    await migrateWorkflows(globalApiConfiguration);
    await updateBranding(globalApiConfiguration, targetEnvName);
}

const end = Date.now();
const difference = end - start;
const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
const seconds = Math.floor((difference % (1000 * 60)) / 1000);
winston.info(clc.bgMagentaBright(`Execution time: ${hours}h ${minutes}m ${seconds}s`));

process.exit(0);