import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { Paginator, TransformsApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, walk, writeConfigFile } from "../util.js";

const TRANSFORM = "TRANSFORM";
const existingAttributeToKeep = [
    "id"
];

const exportTransforms = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Transform Export"));
    const transformsApi = new TransformsApi(apiConfig);
    const transforms = await Paginator.paginate(transformsApi, transformsApi.listTransforms, { limit: 1000 }, 250);
    for (const transform of transforms.data) {
        //Doesn't seem to be a way to provide filters to paginated call, so doing this for now
        if (!transform.internal) {
            winston.info(`Exporting Transform: ${transform.name} (${transform.id})`);
            writeConfigFile(TRANSFORM, transform.name, transform);
        }
    }
}

const migrateTransform = async (apiConfig, transformJson) => {
    const transformApi = new TransformsApi(apiConfig);
    let localTransform = JSON.parse(transformJson);

    //Check and see if a transform with this name already exists in the target environment
    const currentTransformResponse = await transformApi.listTransforms({
        filters: `name eq "${localTransform.name}"`
    });
    let currentTargetTransform = currentTransformResponse.data.length == 1 ? currentTransformResponse.data[0] : null;

    if (!currentTargetTransform) {
        winston.info(`Creating new transform: ${localTransform.name}`);
        try {
            const createTransformResponse = await transformApi.createTransform({
                transform: localTransform
            });
            currentTargetTransform = createTransformResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(`Updating existing transform: ${currentTargetTransform.name} (${currentTargetTransform.id})`)

        //Restore attributes from the currently deployed target transform into our template transform
        for (const transformKey of existingAttributeToKeep) {
            _.set(localTransform, transformKey, _.get(currentTargetTransform, transformKey));
        }

        //Update the transform with all config, references, etc.
        try {
            await transformApi.updateTransform({
                id: currentTargetTransform.id,
                transform: localTransform
            });
        } catch (error) {
            await handleHttpException(error);
        }
    }
}

const migrateTransforms = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Transform Deployment"));
    const transformFilePaths = walk("./build/config/TRANSFORM");

    //Iterate each transform and pass it to migrateTransform
    for (const transformFilePath of transformFilePaths) {
        const transform = fs.readFileSync(transformFilePath);
        await migrateTransform(apiConfig, transform);
    }
    winston.info(clc.bgGreen("Completed Transform Deployment"));
}

export {
    exportTransforms,
    migrateTransform,
    migrateTransforms
};

