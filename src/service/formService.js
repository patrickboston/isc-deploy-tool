import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { CustomFormsBetaApi, Paginator, WorkflowsBetaApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, sleep, walk, writeConfigFile } from "../util.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";

const FORM = "FORM_DEFINITION";
const existingAttributeToKeep = [
    "id"
];

const exportForms = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Form Export"));
    const formsApi = new CustomFormsBetaApi(apiConfig);
    const formsResponse = await Paginator.paginate(formsApi, formsApi.exportFormDefinitionsByTenant, undefined, 250).catch(error => {
        handleHttpException(error);
    });
    //They get exported in sp-config format, but we will store just the object itself
    for (let formContainer of formsResponse.data) {
        const form = formContainer.object;
        winston.info(`Exporting Form: ${form.name} (${form.id})`);
        //Update owner to alias for lookup when migrating
        if (form.owner) {
            const owner = await getIdentityById(apiConfig, form.owner.id);
            form.owner.name = owner.alias;
        }

        writeConfigFile(FORM, form.name, form);
    }
}

const migrateForm = async (apiConfig, formJson) => {
    const formsApi = new CustomFormsBetaApi(apiConfig);
    let localForm = JSON.parse(formJson);

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(apiConfig, localForm.owner.name);
    _.set(localForm, "owner.id", owner.id);

    //Check and see if a workflow with this name already exists in the target environment
    //Current List Workflows endpoint does not allow filtering, so need to iterate all workflows
    const currentFormsResponse = await formsApi.exportFormDefinitionsByTenant({
        filters: `name eq "${localForm.name}"`
    });
    let currentTargetForm = currentFormsResponse.data.length == 1 ? currentFormsResponse.data[0].object : null;

    if (!currentTargetForm) {
        winston.info(`Creating new form: ${localForm.name}`);

        try {
            /*
            const createWorkflowResponse = await formsApi.createFormDefinition({
                createFormDefinitionRequestBeta: {
                    name: ,
                    description: ,
                    owner: ,
                    formConditions: ,
                    formElements: ,
                    formInput: ,
                },
            });
            currentTargetWorkflow = createWorkflowResponse.data;
            */

            //If the local workflow was enabled, we will enable it now with a PATCH
            if (localForm.enabled) {
                winston.info("Create completed and local workflow was marked as enabled, enabling it in target");
                await sleep(1000);
                //Patch workflow to disable so we can update
                try {
                    await workflowsApi.patchWorkflow({
                        id: currentTargetWorkflow.id,
                        jsonPatchOperationBeta: [
                            {
                                op: "replace",
                                path: "/enabled",
                                value: true
                            }
                        ]
                    });
                } catch (error) {
                    await handleHttpException(error);
                }

                //Let the patch bake in for a second or else might throw an error that it's still enabled
                await sleep(1000);
            }
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        /*
         * If workflow is currently enabled, need to disable it before we can modify and then re-enable
         * Additionally, the repo is authoritative for whether the workflow stays enabled or not after
         * it's been modified, so we won't re-enable it if it was enabled in the target, but the repo
         * has it set as disabled
        */
        winston.info(`Updating existing form: ${currentTargetForm.name} (${currentTargetForm.id})`)
        if (currentTargetWorkflow.enabled) {
            winston.warn("Workflow is enabled, disabling it to allow modification");
            //Patch workflow to disable so we can update
            try {
                await workflowsApi.patchWorkflow({
                    id: currentTargetWorkflow.id,
                    jsonPatchOperationBeta: [
                        {
                            op: "replace",
                            path: "/enabled",
                            value: false
                        }
                    ]
                });
            } catch (error) {
                await handleHttpException(error);
            }

            //Let the patch bake in for a second or else might throw an error that it's still enabled
            await sleep(1000);
        }

        //Restore attributes from the currently deployed target workflow into our template workflow
        for (const workflowKey of existingAttributeToKeep) {
            _.set(localForm, workflowKey, _.get(currentTargetWorkflow, workflowKey));
        }

        //Update the workflow with all config, references, etc.
        try {
            await workflowsApi.updateWorkflow({
                id: localForm.id,
                workflowBodyBeta: localForm
            });
        } catch (error) {
            await handleHttpException(error);
        }
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

