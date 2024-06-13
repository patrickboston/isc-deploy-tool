#!/usr/bin/env node
import axiosRetry from "axios-retry";
import clc from "cli-color";
import * as fs from "fs";
import { Configuration } from "sailpoint-api-client";
import { exportAccessRequestConfig } from "./service/accessRequestUtil.js";
import { exportIdentityAttributeConfig, exportIdentityProfiles, migrateIdentityProfile } from "./service/identityConfigService.js";
import { exportGovernanceGroups } from "./service/identityUtil.js";
import { exportNotificationTemplates } from "./service/notificationUtil.js";
import { exportSources } from "./service/sourceService.js";
import { exportTransforms } from "./service/transformUtil.js";
import { exportWorkflows } from "./service/workflowUtil.js";
import { buildObjectsForEnvironment, reverseTokenize, runExport } from "./util.js";

console.info(clc.bgBlueBright("SailPoint IDN Migration Tool"));

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
    target_env: targetEnvName
} = nodeArgs;

//Process args
srcEnvName = srcEnvName && srcEnvName.toLowerCase();
targetEnvName = targetEnvName && targetEnvName.toLowerCase();

//Check export params
if (isExport && (!srcEnvName || srcEnvName == "%npm_config_src_env%")) {
    console.error(clc.bgRed("FAILED: --src_env argument is required for export but was not supplied, exiting"));
    process.exit(1);
} else {
    console.info(clc.bgMagentaBright(`Running with src_env: ${srcEnvName}`));
}

//Check build params
if (isBuild && (!targetEnvName || targetEnvName == "%npm_config_target_env%")) {
    console.error(clc.bgRed("FAILED: --target_env argument is required for build but was not supplied, exiting"));
    process.exit(1);
} else {
    console.info(clc.bgMagentaBright(`Running build with target_env: ${targetEnvName}`));
}

//Check deploy params
if (isDeploy && (!targetEnvName || targetEnvName == "%npm_config_target_env%")) {
    console.error(clc.bgRed("FAILED: --target_env argument is required for deploy but was not supplied, exiting"));
    process.exit(1);
} else {
    console.info(clc.bgMagentaBright(`Running deploy with target_env: ${targetEnvName}`));
}

//Perform export setup and process
if (isExport) {
    //Set up config based on envirnments
    const { default: srcEnvParams } = await import("./../" + srcEnvName + ".env.js");

    let srcApiConfig = new Configuration(srcEnvParams);
    srcApiConfig.retriesConfig = {
        retries: 4,
        retryDelay: axiosRetry.exponentialDelay,
        onRetry(retryCount, error, requestConfig) {
            console.log(clc.yellow(`Retrying due to request error, try number ${retryCount}`));
        }
    }

    if (isExport && isDetokenize) {
        console.log(clc.bgMagentaBright("Running export and de-tokenization..."));

        //await exportRules(srcApiConfig);
        await exportTransforms(srcApiConfig);
        await exportSources(srcApiConfig);
        await exportIdentityAttributeConfig(srcApiConfig);
        await exportIdentityProfiles(srcApiConfig);
        await exportAccessRequestConfig(srcApiConfig);
        await exportNotificationTemplates(srcApiConfig);
        await exportWorkflows(srcApiConfig);
        await exportGovernanceGroups(srcApiConfig);

        await reverseTokenize();

    } else if (isExport && !isDetokenize) {
        console.log(clc.bgMagentaBright("Running raw export WITHOUT de-tokenization"));
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
        retries: 4,
        retryDelay: axiosRetry.exponentialDelay,
        onRetry(retryCount, error, requestConfig) {
            console.log(clc.yellow(`Retrying due to request error, try number ${retryCount}`));
        }
    }

    await buildObjectsForEnvironment(targetEnvName);

    /**
     * Objects need to be migrated in a specific order for reference sake. That order is:
     * 1. Rules (Connector + Already Approved Cloud)
     * 2. Transforms
     * 3. Connector (Not supported at the moment)
     * 4. Identity Object Config
     * 5. Identity Profile
     * 6. Lifecycle State
     * 7. Workflow
    */

    /*********************** TESTING *******************************/
    //const s = fs.readFileSync("./build/config/SOURCE/JAR TEST/JAR TEST.json");
    //await migrateSource(targetApiConfig, s);
    //const w = fs.readFileSync("./build/config/WORKFLOW/Mover Certification New Deploy.json");
    //await migrateWorkflow(targetApiConfig, w);
    //const t = fs.readFileSync("./build/config/TRANSFORM/TestTransform.json");
    //await migrateTransform(targetApiConfig, t);
    //const t = fs.readFileSync("./build/config/NOTIFICATION_TEMPLATE/Non-Employee Account Upload Failed.json");
    //await migrateNotificationTemplate(targetApiConfig, t);
    //const a = fs.readFileSync("./build/config/ACCESS_REQUEST_CONFIG/ACCESS_REQUEST_CONFIG.json");
    //await updateAccessRequestConfig(targetApiConfig, a);
    //const a = fs.readFileSync("./build/config/GOVERNANCE_GROUP/Test Deploy.json");
    //await migrateGovernanceGroup(targetApiConfig, a);
    //const i = fs.readFileSync("./build/config/IDENTITY_OBJECT_CONFIG/IDENTITY_OBJECT_CONFIG.json");
    //await migrateIdentityAttributeConfig(targetApiConfig, i);
    const i = fs.readFileSync("./build/config/IDENTITY_PROFILE/Aking Users.json");
    await migrateIdentityProfile(targetApiConfig, i);
}


process.exit(0);