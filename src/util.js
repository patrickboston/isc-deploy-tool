import clc from "cli-color";
import * as fs from "fs";
import { JSONPath } from "jsonpath-plus";
import _ from 'lodash';
import { SPConfigBetaApi } from "sailpoint-api-client";
import winston from "winston";
import { default as exportIgnore } from "../export-ignore.js";
import { default as reverseTokens } from "./../reverse.target.js";

/**
* Sleeps for the specified number of milliseconds
* @param {number} ms Time to sleep for in milliseconds
*/
const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
* Helper function to handle all of our HTTP requests via the SailPoint SDK
* @param {Error} e The error which was caught
*/
const handleHttpException = async (e) => {
    if (e.response) {
        winston.error(clc.red(`Error while executing request:\nPath: ${e.request.method} ${e.request.path}\n${JSON.stringify(JSON.parse(e.config.data), null, 4)}\nStatus Code: ${e.response.status}\nResponse Data: ${JSON.stringify(e.response.data, null, 4)}`));
    } else {
        winston.error(clc.red(`Generic while executing request: ${e.message}`));
    }
    process.exit(0);
}

/**
* Recursively iterates all files in a given directory and returns a list of their full paths
* @param {string} dir The name of the directory to walk
* @param {number} [maxDepth=-1] How many directories deep to look
* @returns {Array} List of full file paths found
*/
function walk(dir, maxDepth = -1, currentDepth = 0, files = []) {
    //Get an array of all files and directories in the passed directory using fs.readdirSync
    if (fs.existsSync(dir)) {
        const fileList = fs.readdirSync(dir);
        //Create the full path of the file/directory by concatenating the passed directory and file/directory name
        for (const file of fileList) {
            const name = `${dir}/${file}`;
            //Check if the current file/directory is a directory using fs.statSync
            if (fs.statSync(name).isDirectory()) {
                if (maxDepth === -1 || currentDepth < maxDepth) {
                    //If it is a directory and we haven't reached max depth, recursively call the walk function
                    walk(name, maxDepth, currentDepth + 1, files);
                }
            } else {
                //If it is a file, push the full path to the files array
                files.push(name);
            }
        }
    } else {
        winston.warn(clc.yellow(`Directory [${dir}] does not exist`));
    }
    return files;
}

//transformDefinition ignore key  is very specific to identity profile transform references using key 'id'
function deepOmit(obj, keysToOmit = ["id", "created", "modified", "sourceId", "cloudExternalId", "cloudCacheUpdate", "since", "status", "healthy", "identityCount", "standardLogoURL"], keysToIgnore = ["transformDefinition"]) {
    let keysToOmitIndex = _.keyBy(Array.isArray(keysToOmit) ? keysToOmit : [keysToOmit]); // create an index object of the keys that should be omitted

    function omitFromObject(obj) { //the inner function which will be called recursively

        return _.transform(obj, function (result, value, key) { // transform to a new object
            if (key in keysToOmitIndex) { //if the key is in the index skip it
                return;
            }

            result[key] = _.isObject(value) && !keysToIgnore.includes(key) ? omitFromObject(value) : value;
        })
    }
    return omitFromObject(obj); //return the inner function result
}

/**
* Writes a IDN Config file to the specified location
* creating a directory if needed to hold the object
* Also omits certain attributes by default
* @param {string} objectType Used for directory name and other special checks
* @param {string} objectName Used for file name
* @param {Object} object The actual object to write in JSON format
* @param {string} [overrideDir=null] Override default write directory built from this function
*/
const writeConfigFile = (objectType, objectName, object, overrideDir = null) => {
    //TODO: Create export ignore properties to avoid writing certain config files
    const dir = overrideDir ? "./config/" + overrideDir : "./config/" + objectType;
    //Create directory for object type if it does not exist yet
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    //Write JSON file for object, replace characters not allowed in file names with dash
    let fileName = dir + "/" + objectName.replace(/[/\\?%*:|"<>]/g, '-') + ".json";

    const ignoreFormat = `${objectType}:${objectName}`
    if (exportIgnore.includes(ignoreFormat)) {
        winston.info(clc.yellow(`${ignoreFormat} is set up for export ignore, not writing config file`));
        if (fs.existsSync(fileName)) {
            winston.info(clc.yellow(`${fileName} exists from previous exports, deleting it`));
            fs.unlinkSync(fileName);
        }
    } else {
        //Cloud Rule objects cannot be modified at all or else the signature validation fails, so don't omit from them
        let omittedObj = objectType !== "CLOUD_RULE" ? deepOmit(object) : object;
        fs.writeFileSync(fileName, JSON.stringify(omittedObj, null, 4));
    }
}

const reverseTokenize = async () => {
    winston.info(clc.bgBlueBright("Starting Reverse Tokenization"));
    return new Promise((resolve, reject) => {
        if (!reverseTokens) reject("No tokens to process")

        //Iterate each object/file
        Object.entries(reverseTokens).forEach((objectEntry) => {
            const [fileName, tokens] = objectEntry;
            const fileLocation = "./config/" + fileName;
            try {
                const fileSource = fs.readFileSync(fileLocation);
                let json = JSON.parse(fileSource);

                //Iterate each token for a specific object/file
                Object.entries(tokens).forEach((token) => {
                    const [jPath, tokenValue] = token;
                    winston.debug(`Checking file [${fileName}] for JSONPath [${jPath}]`);

                    let results = JSONPath({
                        path: jPath,
                        json: json,
                        resultType: "all"
                    });

                    //If we find a matching object via JSONPath, replace it with the reverse token
                    if (Array.isArray(results) && results.length > 0) {
                        //Convert the JSONPath pointer to make it actual JavaScript dot notation
                        let correctPointer = results[0].pointer.replaceAll("/", ".").substring(1);
                        _.set(json, correctPointer, tokenValue);
                        winston.info(clc.green(`JSONPath match found in file [${fileLocation}], replacing environment value with token: ${tokenValue}`));
                    } else {
                        winston.warn(clc.yellow(`Could not find JSON element in file [${fileLocation}] for path: ` + jPath));
                    }
                });

                //Save the updated JSON
                fs.writeFileSync(fileLocation, JSON.stringify(json, null, 4));
            } catch (err) {
                if (err.code === 'ENOENT') {
                    winston.info(clc.bgRed(`File not found defined in reverse.target.js: ${fileLocation}`));
                } else {
                    throw err;
                }
            }
        });
        resolve("Reverse tokenization complete");
    })
}

const escapeString = (str) => {
    return str.replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

const buildObjectsForEnvironment = async (env) => {
    winston.info(clc.bgBlueBright(`Starting object tokenization for target environment: ${env}`))

    //Standard Tokens
    const envTokenFileName = "./../" + env + ".target.js";
    let { default: envTokens } = await import(envTokenFileName);

    //Secret Tokens
    const secretTokenFileName = "./../" + env + ".secrets.js";
    try {
        const { default: secretTokens } = await import(secretTokenFileName);

        //Merge secrets into existing tokens object
        envTokens = { ...envTokens, ...secretTokens };
    } catch (e) {
        winston.info(clc.yellow(`No secrets file found for target environment [${env}]`));
    }

    //Create directory for object type if it does not exist yet
    if (!fs.existsSync("./build/config/")) {
        fs.mkdirSync("./build/config/", { recursive: true });
    }

    //Iterate each config file from export
    const configFileNames = walk("./config");
    for (const fileName of configFileNames) {
        // build CONNECTOR_RULE separate to inject script from .bsh file
        if (fileName.endsWith(".json")) {
            let fileSource = fs.readFileSync(fileName, { encoding: "utf8" });

            // if this is a connector rule, then inject script from source file
            if (fileName.startsWith("./config/CONNECTOR_RULE/")) {
                winston.debug(`Injecting source script for rule ${fileName}`);
                
                // get a copy of the script from the .bsh file
                let scriptFileName = fileName.replace(".json", ".source.bsh");
                let scriptSource = fs.readFileSync(scriptFileName, { encoding: "utf8" });

                // convert fileSource to JSON and set sourceCode.script
                let rule = JSON.parse(fileSource);
                rule.sourceCode.script = scriptSource;

                // convert back
                fileSource = JSON.stringify(rule, null, 4);
            }

            winston.debug(`Checking file ${fileName} for token replacement`);
            Object.entries(envTokens).forEach((token) => {
                const [tokenName, tokenValue] = token;
                const globalRegex = new RegExp(tokenName, 'g');
                const matches = fileSource.match(globalRegex);
                if (matches) {
                    winston.info(clc.green(`${matches.length} occurrence(s) of token name [${tokenName}] found in file [${fileName}]`));
                }
                //Stringify the value so it's escaped properly if a secret token or something
                if (typeof tokenValue === "string") {
                    fileSource = fileSource.replaceAll(tokenName, escapeString(tokenValue));
                } else {
                    fileSource = fileSource.replaceAll(tokenName, JSON.stringify(tokenValue));
                }
            });

            //Write tokenized file to /build/[TYPE] directory
            const outputFileName = "./build/" + fileName.substring(2);
            const outputDir = outputFileName.substring(0, outputFileName.lastIndexOf('/'));

            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(outputFileName, fileSource);
        }
    }
}

const buildSpConfigDeploymentFile = async (directoryToBuildFrom = "./build/config/") => {
    try {
        if (!fs.existsSync(directoryToBuildFrom)) {
            throw new Error(`${directoryToBuildFrom} directory does not exist, no objects to deploy`);
        }

        let objectArray = [];
        const configFileNames = walk(directoryToBuildFrom);
        for (const fileName of configFileNames) {
            let fileSource = fs.readFileSync(fileName, { encoding: "utf8" });
            winston.debug(`Including file ${fileName} for SP-Config deployment file`);
            const objectJson = JSON.parse(fileSource);
            objectArray.push(objectJson);
        }
        const deploymentObj = {
            objects: objectArray
        };
        winston.debug(`Writing SP-Config import file to ${directoryToBuildFrom}`);
        fs.writeFileSync(`${directoryToBuildFrom}/sp-config-deploy.json`, JSON.stringify(deploymentObj, null, 4));
        return deploymentObj;
    } catch (error) {
        throw new Error(error);
    }
}

const runSpConfigExport = async (apiConfig, exportConfig) => {
    winston.info(clc.green("SP-Config export started"));
    const spConfigApi = new SPConfigBetaApi(apiConfig);

    let jobId;
    try {
        const startExportResponse = await spConfigApi.exportSpConfig({
            exportPayloadBeta: JSON.stringify(exportConfig)
        });
        jobId = startExportResponse.data.jobId;
        winston.debug(`SP-Config Export jobId: ${jobId}`);
    } catch (error) {
        handleHttpException(error);
        return; // Exit if the jobId cannot be retrieved
    }

    //Delay function to use with async/await
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    //Function to repeatedly check the import status
    const checkStatus = async () => {
        while (true) {
            try {
                const currentStatusResponse = await spConfigApi.getSpConfigExportStatus({ id: jobId });
                winston.debug(`Current SP-Config export status for jobId [${jobId}]:\n${JSON.stringify(currentStatusResponse.data, null, 4)}`);
                if (currentStatusResponse.data.status === "COMPLETE") {
                    winston.info(clc.green("SP-Config export completed"));
                    break;
                } else if (currentStatusResponse.data.status === "IN_PROGRESS") {
                    winston.info(`SP-Config export job [${jobId}] still in progress...`);
                    await delay(2000); // Wait before checking the status again
                } else if (currentStatusResponse.data.status === "CANCELLED" || currentStatusResponse.data.status === "FAILED") {
                    winston.error(clc.red(`SP-Config export job [${jobId}] has been cancelled or failed!\n${JSON.stringify(currentStatusResponse.data, null, 4)}`));
                    process.exit(1);
                }
            } catch (error) {
                handleHttpException(error);
                break;
            }
        }
    };

    //Initial delay before starting to check the status
    await delay(2000);
    await checkStatus();

    //Continue to get result if we actually have a jobId
    if (jobId) {
        try {
            const exportResponse = await spConfigApi.getSpConfigExport({ id: jobId });
            winston.debug(`SP-Config export full response:\n${JSON.stringify(exportResponse.data, null, 4)}`);
            return exportResponse.data.objects;
        } catch (error) {
            handleHttpException(error);
        }
    }
}

const runSpConfigImport = async (apiConfig, importObj) => {
    winston.info(clc.green("SP-Config import started"));
    let spConfigApi = new SPConfigBetaApi(apiConfig);

    const jsonString = JSON.stringify(importObj);
    const blobPayload = new Blob([jsonString], {
        type: 'application/json'
    });

    let jobId;
    try {
        const startImportResponse = await spConfigApi.importSpConfig({ data: blobPayload });
        jobId = startImportResponse.data.jobId;
        winston.debug(`SP-Config import jobId: ${jobId}`);
    } catch (error) {
        handleHttpException(error);
        return; // Exit if the jobId cannot be retrieved
    }

    //Delay function to use with async/await
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    //Function to repeatedly check the import status
    const checkStatus = async () => {
        while (true) {
            try {
                const currentStatusResponse = await spConfigApi.getSpConfigImportStatus({ id: jobId });
                winston.debug(`Current SP-Config import status for jobId [${jobId}]:\n${JSON.stringify(currentStatusResponse.data, null, 4)}`);
                if (currentStatusResponse.data.status === "COMPLETE") {
                    winston.info(clc.green("SP-Config import completed"));
                    break;
                } else if (currentStatusResponse.data.status === "IN_PROGRESS") {
                    winston.info(`SP-Config import job [${jobId}] still in progress...`);
                    await delay(2000); // Wait before checking the status again
                } else if (currentStatusResponse.data.status === "CANCELLED" || currentStatusResponse.data.status === "FAILED") {
                    winston.error(clc.red(`SP-Config import job [${jobId}] has been cancelled or failed!\n${JSON.stringify(currentStatusResponse.data, null, 4)}`));
                    process.exit(1);
                }
            } catch (error) {
                handleHttpException(error);
                break;
            }
        }
    };

    //Initial delay before starting to check the status
    await delay(2000);
    await checkStatus();

    //Continue to get result if we actually have a jobId
    if (jobId) {
        try {
            const importResponse = await spConfigApi.getSpConfigImport({ id: jobId });
            winston.debug(`SP-Config import full response:\n${JSON.stringify(importResponse.data, null, 4)}`);
            return importResponse;
        } catch (error) {
            handleHttpException(error);
        }
    }
    winston.info(clc.green("SP-Config import completed"));
};


export { buildObjectsForEnvironment, buildSpConfigDeploymentFile, deepOmit, handleHttpException, reverseTokenize, runSpConfigExport, runSpConfigImport, sleep, walk, writeConfigFile };

