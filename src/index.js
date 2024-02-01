#!/usr/bin/env node
import { runExport, reverseTokenize, buildObjectsForEnvironment, buildDeploymentFile, runDeploy } from "./util.js";
import { getSources } from "./sourceUtil.js";
import { Configuration } from "sailpoint-api-client";
import axiosRetry from "axios-retry";
import clc from "cli-color";

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

        await getSources(srcApiConfig);
        await reverseTokenize();

    } else if (isExport && !isDetokenize) {
        console.log(clc.bgMagentaBright("Running raw export WITHOUT de-tokenization"));
        await runExport(srcApiConfig);
    }
}

//Perform local build only
if (isBuild) {
    await buildObjectsForEnvironment(targetEnvName);
    buildDeploymentFile();
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
    const deployObj = buildDeploymentFile();

    //Convert to a Blob for the HTTP multipart form data
    const jsonString = JSON.stringify(deployObj);
    const blobPayload = new Blob([jsonString], {
        type: 'application/json'
    });

    await runDeploy(targetApiConfig, blobPayload).then((result) => {
        console.info(JSON.stringify(result, null, 4));
    });
}


process.exit(0);