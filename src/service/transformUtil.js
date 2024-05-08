import { Paginator, TransformsApi } from "sailpoint-api-client";
import { writeConfigFile } from "../util.js";
import clc from "cli-color";
import _ from 'lodash';

const TRANSFORM = "TRANSFORM";
const existingAttributeToKeep = [
    "id"
];

const exportTransforms = async (apiConfig) => {
    const transformsApi = new TransformsApi(apiConfig);
    const transforms = await Paginator.paginate(transformsApi, transformsApi.listTransforms, { limit: 1000 }, 250);
    for (const transform of transforms.data) {
        writeConfigFile(TRANSFORM, transform.name, transform);
    }
}

const migrateTransform = async (apiConfig, transformJson) => {
    const transformApi = new TransformsApi(apiConfig);

    let localTransform = JSON.parse(transformJson);
    console.log(clc.bgBlueBright(`Migrating transform: ${localTransform.name}`));

    //Check and see if a transform with this name already exists in the target environment
    const currentTransformResponse = await transformApi.listTransforms({
        filters: `name eq "${localTransform.name}"`
    });
    let currentTargetTransform = currentTransformResponse.data.length == 1 ? currentTransformResponse.data[0] : null;

    if (!currentTargetTransform) {
        console.log(`Creating new transform for: ${localTransform.name}`);
        const createTransformResponse = await transformApi.createTransform({
            transform: localTransform
        });
        currentTargetTransform = createTransformResponse.data;
    } else {
        console.log(`Found existing transform in target environment: ${currentTargetTransform.name} (${currentTargetTransform.id})`)

        //Restore attributes from the currently deployed target transform into our template transform
        for (const transformKey of existingAttributeToKeep) {
            _.set(localTransform, transformKey, _.get(currentTargetTransform, transformKey));
        }

        //Update the transform with all config, references, etc.
        await transformApi.updateTransform({
            id: currentTargetTransform.id,
            transform: localTransform
        });
    }
}

export {
    exportTransforms,
    migrateTransform
};