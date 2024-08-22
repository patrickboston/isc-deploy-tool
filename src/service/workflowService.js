import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { Paginator, WorkflowsApi, WorkflowsBetaApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, sleep, walk, writeConfigFile } from "../util.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";

const WORKFLOW = "WORKFLOW";
const existingAttributeToKeep = [
    "id"
];

const exportWorkflows = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Workflow Export"));
    const workflowsApi = new WorkflowsApi(apiConfig);
    const workflows = await Paginator.paginate(workflowsApi, workflowsApi.listWorkflows, undefined, 250).catch(error => {
        handleHttpException(error);
    });
    for (let workflow of workflows.data) {
        winston.info(`Exporting Workflow: ${workflow.name} (${workflow.id})`);
        //Update owner/creator/modifiedBy to alias for lookup when migrating
        if (workflow.owner) {
            const owner = await getIdentityById(apiConfig, workflow.owner.id);
            workflow.owner.name = owner.alias;
        }

        writeConfigFile(WORKFLOW, workflow.name, workflow);
    }
}

const migrateWorkflow = async (apiConfig, workflowJson) => {
    //Using /beta/workflows here because /v3 seems to fail for no reason
    const workflowsApi = new WorkflowsBetaApi(apiConfig);
    let localWorkflow = JSON.parse(workflowJson);

    //Get corresponding owner by name and add id
    const owner = await getIdentityByAlias(apiConfig, localWorkflow.owner.name);
    _.set(localWorkflow, "owner.id", owner.id);

    //Check and see if a workflow with this name already exists in the target environment
    //Current List Workflows endpoint does not allow filtering, so need to iterate all workflows
    const currentWorkflowsResponse = await workflowsApi.listWorkflows();
    let currentTargetWorkflow;
    for (const currentWorkflow of currentWorkflowsResponse.data) {
        if (currentWorkflow.name === localWorkflow.name) {
            currentTargetWorkflow = currentWorkflow;
        }
    }

    if (!currentTargetWorkflow) {
        winston.info(`Creating new workflow: ${localWorkflow.name}`);

        try {
            const createWorkflowResponse = await workflowsApi.createWorkflow({
                createWorkflowRequestBeta: {
                    name: localWorkflow.name,
                    owner: localWorkflow.owner,
                    definition: localWorkflow.definition,
                    description: localWorkflow.description,
                    enabled: false, //Workflows cannot be created in an enabled state, so we have to create it disabled
                    trigger: localWorkflow.trigger
                }
            });
            currentTargetWorkflow = createWorkflowResponse.data;

            //If the local workflow was enabled, we will enable it now with a PATCH
            if (localWorkflow.enabled) {
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
        winston.info(`Updating existing workflow: ${currentTargetWorkflow.name} (${currentTargetWorkflow.id})`)
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
            _.set(localWorkflow, workflowKey, _.get(currentTargetWorkflow, workflowKey));
        }

        //Update the workflow with all config, references, etc.
        try {
            await workflowsApi.updateWorkflow({
                id: localWorkflow.id,
                workflowBodyBeta: localWorkflow
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
    exportWorkflows,
    migrateWorkflow,
    migrateWorkflows
};

