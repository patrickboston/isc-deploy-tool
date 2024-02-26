import { default as exportConfig } from "./../export-config.js";
import { default as reverseTokens } from "./../reverse.target.js";
import * as fs from "fs";
const { lastIndexOf } = pkg;
import pkg from 'lodash';
import clc from "cli-color";
import { JSONPath } from "jsonpath-plus";
import { SPConfigBetaApi } from "sailpoint-api-client";

function walk(dir, files = []) {
    // Get an array of all files and directories in the passed directory using fs.readdirSync
    const fileList = fs.readdirSync(dir);
    // Create the full path of the file/directory by concatenating the passed directory and file/directory name
    for (const file of fileList) {
        const name = `${dir}/${file}`;
        // Check if the current file/directory is a directory using fs.statSync
        if (fs.statSync(name).isDirectory()) {
            // If it is a directory, recursively call the getFiles function with the directory path and the files array
            walk(name, files);
        } else {
            // If it is a file, push the full path to the files array
            files.push(name);
        }
    }
    return files;
}

function deepOmit(obj, keysToOmit) {
    let keysToOmitIndex = _.keyBy(Array.isArray(keysToOmit) ? keysToOmit : [keysToOmit]); // create an index object of the keys that should be omitted
    const keysToIgnore = [
        "owner",
        "passwordPolicies"
    ];

    function omitFromObject(obj) { // the inner function which will be called recursivley

        return _.transform(obj, function (result, value, key) { // transform to a new object
            if (key in keysToOmitIndex) { // if the key is in the index skip it
                return;
            }

            result[key] = _.isObject(value) && !keysToIgnore.includes(key) ? omitFromObject(value) : value;
        })
    }
    return omitFromObject(obj); // return the inner function result
}

const checkExportStatus = async (spConfigApi, jobId, timeout = 10000) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            (async function wait() {
                spConfigApi.getSpConfigExportStatus({ id: jobId }).then((response) => {
                    if (response.data.status == "COMPLETE") {
                        console.info(clc.bgGreen("SP-Config export completed"));
                        resolve(response);
                    } else if (response.data.status == "IN_PROGRESS") {
                        console.log(clc.green("Export job [" + jobId + "] still in progress..."));
                        setTimeout(wait, 100);
                    } else if (response.data.status == "CANCELLED" || response.data.status == "FAILED") {
                        console.error(response);
                        resolve("Export job [" + jobId + "] has been cancelled or failed!");
                    }
                })
            })();
        }, 3000);
    });
}

const getExportResult = async (spConfigApi, jobId) => {
    await spConfigApi.getSpConfigExport({ id: jobId }).then((response) => {
        const responseObjects = response.data.objects;
        responseObjects.forEach((responseObject) => {
            const objectType = responseObject.self.type;
            const objectName = responseObject.self.name;
            const objectSource = responseObject.object;
            console.log(`Exporting object: ${objectName} (${objectType})`);

            //Delete id, created, modified where applicable
            responseObject = deepOmit(responseObject, ["id", "created", "modified"]);

            //Create directory for object type if it does not exist yet
            if (!fs.existsSync("./config/" + objectType)) {
                fs.mkdirSync("./config/" + objectType, { recursive: true });
            }

            if (objectType == "RULE") {
                const source = objectSource.sourceCode.script;
                const ruleSourceFileName = "./config/" + objectType + "/" + objectName + ".source.txt";
                fs.writeFileSync(ruleSourceFileName, unescape(source), null, 4);
            }

            //Write JSON file for object
            const fileName = "./config/" + objectType + "/" + objectName + ".json";
            fs.writeFileSync(fileName, JSON.stringify(responseObject, null, 4));
        })
    });
}

const runExport = async (apiConfig) => {
    console.info(clc.bgBlueBright("Performing tenant export"));
    return new Promise((resolve, reject) => {
        let spConfigApi = new SPConfigBetaApi(apiConfig);

        let spConfigReq = {
            exportPayloadBeta: JSON.stringify(exportConfig)
        };

        spConfigApi.exportSpConfig(spConfigReq).then((response) => {
            const jobId = response.data.jobId;
            checkExportStatus(spConfigApi, jobId).then((response) => {
                resolve(getExportResult(spConfigApi, jobId));
            });
        });
    })
}

const reverseTokenize = async () => {
    console.info(clc.bgBlueBright("Performing reverse tokenization"));
    return new Promise((resolve, reject) => {
        if (!reverseTokens) reject("No tokens to process")

        //Iterate each object/file
        Object.entries(reverseTokens).forEach((objectEntry) => {
            const [fileName, tokens] = objectEntry;
            const fileLocation = "./config/" + fileName;
            try {
                const fileSource = fs.readFileSync(fileLocation);

                console.info(`Checking file: ${fileLocation}`);
                let json = JSON.parse(fileSource);

                //Iterate each token for a specific object/file
                Object.entries(tokens).forEach((token) => {
                    const [jPath, tokenValue] = token;
                    console.info(`Checking file [${fileName}] for JSONPath [${jPath}]`);

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
                        console.info(clc.bgGreen(`JSONPath match found, replacing value with token: ${tokenValue}`));
                    } else {
                        console.warn(clc.yellow("Could not find JSON element for path: " + jPath));
                    }
                });

                //Save the updated JSON
                fs.writeFileSync(fileLocation, JSON.stringify(json, null, 4));
            } catch (err) {
                if (err.code === 'ENOENT') {
                    console.info(clc.bgRed(`File not found defined in reverse.target.js: ${fileLocation}`));
                } else {
                    throw err;
                }
            }
        });
        console.info(clc.bgGreenBright("Reverse tokenization complete"));
        resolve("Reverse tokenization complete");
    })
}

const buildObjectsForEnvironment = async (env) => {
    console.info(clc.bgBlueBright(`Tokenizing objects for target environment: ${env}`))
    const envTokenFileName = "./../" + env + ".target.js";
    const { default: envTokens } = await import(envTokenFileName);

    //Create directory for object type if it does not exist yet
    if (!fs.existsSync("./build/config/")) {
        fs.mkdirSync("./build/config/", { recursive: true });
    }

    //Iterate each config file from export
    const configFileNames = walk('./config');
    configFileNames.forEach((fileName) => {
        if (fileName.endsWith(".json")) {
            let fileSource = fs.readFileSync(fileName, { encoding: "utf8" });
            console.info(`Checking file ${fileName} for token replacement`);
            Object.entries(envTokens).forEach((token) => {
                const [tokenName, tokenValue] = token;
                const matches = fileSource.match(tokenName);
                if (matches) {
                    console.info(clc.bgGreen(`${matches.length} occurence(s) of token name [${tokenName}] found in file [${fileName}]`));
                }
                fileSource = fileSource.replaceAll(tokenName, tokenValue);
            });

            //Write tokenized file to /build/[TYPE] directory
            const objectJson = JSON.parse(fileSource);
            const outputDir = "./build/config/" + objectJson.self.type
            const outputFileName = outputDir + "/" + objectJson.self.name + ".json";

            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(outputFileName, fileSource);
        }
    });
}

const buildDeploymentFile = () => {
    try {
        if (!fs.existsSync("./build/config/")) {
            throw new Error("./build/config directory does not exist, no objects to deploy");
        }

        let objectArray = [];
        const configFileNames = walk('./build/config');
        configFileNames.forEach((fileName) => {
            let fileSource = fs.readFileSync(fileName, { encoding: "utf8" });
            console.info(`Including file ${fileName} for deployment`);
            const objectJson = JSON.parse(fileSource);
            objectArray.push(objectJson);

            

            //Moved this code block into the loop, trying to have it write separate objects (see +deploymentObjName+) based on each fileName, not working / erroring
            
            const deploymentObjName = fileName.substring(14,fileName.lastIndexOf("/"));

            const deploymentObj = {
                objects: objectArray
            };
            fs.writeFileSync("./build/deploy" + deploymentObjName + ".json", JSON.stringify(deploymentObj, null, 4));
            return deploymentObj;
            
            //
        });
        /*
        const deploymentObj = {
            objects: objectArray
        };
        fs.writeFileSync("./build/deploy.json", JSON.stringify(deploymentObj, null, 4));
        return deploymentObj;
        */
    } catch (error) {
        throw new Error(error);
    }
}

const checkImportStatus = async (spConfigApi, jobId, timeout = 10000) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            (async function wait() {
                spConfigApi.getSpConfigImportStatus({ id: jobId }).then((response) => {
                    if (response.data.status == "COMPLETE") {
                        console.info(clc.bgGreen("SP-Config import completed"));
                        resolve(response);
                    } else if (response.data.status == "IN_PROGRESS") {
                        console.log(clc.green("Import job [" + jobId + "] still in progress..."));
                        setTimeout(wait, 100);
                    } else if (response.data.status == "CANCELLED" || response.data.status == "FAILED") {
                        resolve(clc.red("Import job [" + jobId + "] has been cancelled or failed!"));
                    }
                });
            })();
        }, 3000);
    });
}

const getImportResult = async (spConfigApi, jobId) => {
    return new Promise((resolve) => {
        spConfigApi.getSpConfigImport({ id: jobId }).then((response) => {
            const result = response.data;
            resolve(result);
        });
    });
}

//Assuming I need to figure out how to have this loop through different json objects to run the deployment
const runDeploy = async (apiConfig, importData) => {
    return new Promise((resolve, reject) => {
        console.info(clc.bgBlueBright("Performing tenant deployment"));
        let spConfigApi = new SPConfigBetaApi(apiConfig);

        spConfigApi.importSpConfig({ data: importData }).then((response) => {
            const jobId = response.data.jobId;
            checkImportStatus(spConfigApi, jobId).then((response) => {
                resolve(getImportResult(spConfigApi, jobId));
            })
        });
    });
}

export {
    buildObjectsForEnvironment,
    buildDeploymentFile,
    runExport,
    runDeploy,
    reverseTokenize
};