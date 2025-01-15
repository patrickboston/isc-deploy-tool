import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { CustomFormsBetaApi, Paginator, WorkflowsBetaApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, sleep, walk, writeConfigFile } from "../util.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";

const FORM = "FORM_DEFINITION";
const existingAttributeToKeep = [
    "object.id", "self.id"
];

const exportForms = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Form Export"));
    const formsApi = new CustomFormsBetaApi(apiConfig);
    const formsResponse = await Paginator.paginate(formsApi, formsApi.exportFormDefinitionsByTenant, undefined, 250).catch(error => {
        handleHttpException(error);
    });
    /* 
     * They get exported in sp-config format like identity profile export,
     * we retain this format so they are easier to import and we do not have to perform PATCH operations
    */
    for (let formContainer of formsResponse.data) {
        winston.info(`Exporting Form: ${formContainer.self.name} (${formContainer.self.id})`);
        //Update owner to alias for lookup when migrating
        if (formContainer.object.owner) {
            const owner = await getIdentityById(apiConfig, formContainer.object.owner.id);
            formContainer.object.owner.name = owner.alias;
        }

        writeConfigFile(FORM, formContainer.self.name, formContainer);
    }
}

const migrateForm = async (apiConfig, formJson) => {
    const formsApi = new CustomFormsBetaApi(apiConfig);
    let localForm = JSON.parse(formJson);

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(apiConfig, localForm.object.owner.name);
    _.set(localForm, "object.owner.id", owner.id);

    //Check and see if a workflow with this name already exists in the target environment
    //Current List Workflows endpoint does not allow filtering, so need to iterate all workflows
    const currentFormsResponse = await formsApi.exportFormDefinitionsByTenant({
        filters: `name eq "${localForm.self.name}"`
    });
    let currentTargetForm = currentFormsResponse.data.length == 1 ? currentFormsResponse.data[0] : null;

    if (currentTargetForm) {
        winston.info(`Updating existing Form: ${localForm.self.name} (${currentTargetForm.self.id})`);
        //Restore attributes from the currently deployed target object into our template object
        for (const key of existingAttributeToKeep) {
            _.set(localForm, key, _.get(currentTargetForm, key));
        }
    } else {
        winston.info(clc.bgBlueBright(`Creating new Form: ${localIdentityProfile.self.name}`));
    }

    //Create and update will both us sp-config type import endpoint
    let importResponse;
    try {
        importResponse = await formsApi.importFormDefinitions({
            body: [
                localForm
            ]
        })
        //We need to fetch it now since it's not returned in the response
        const currentFormResponse = await formsApi.exportFormDefinitionsByTenant({
            filters: `name eq "${localForm.self.name}"`
        }).catch(error => {
            handleHttpException(error);
        });
        currentTargetForm = currentFormResponse.data.length == 1 ? currentFormResponse.data[0] : null;
        if (currentTargetForm == null) {
            winston.error(clc.red(`Could not fetch form by name [${localForm.object.name}] after create/update`));
            process.exit(1);
        }
    } catch (error) {
        await handleHttpException(error);
    }

    //Since this is sp-config import, we need to check for errors manually in the body
    if (importResponse.data.errors.length > 0) {
        winston.error(clc.red(JSON.stringify(importResponse.data, null, 4)));
        process.exit(1);
    }
}

const migrateWorkflows = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Workflow Deployment"));
    //Only read one directory down where main source files are
    const workflowFilePaths = walk("./build/config/WORKFLOW");

    //Iterate each workflow and pass it to migrateSource
    for (const workflowFilePath of workflowFilePaths) {
        const workflow = fs.readFileSync(workflowFilePath);
        await migrateWorkflow(apiConfig, workflow);
    }
    winston.info(clc.bgGreen("Completed Workflow Deployment"));
}

export {
    exportForms,
    migrateForm,
    migrateWorkflows
};

