import clc from "cli-color";
import { Paginator, WorkflowsApi, WorkflowsBetaApi } from "sailpoint-api-client";
import { writeConfigFile } from "../util.js";
import { getIdentityByName } from "./identityUtil.js";
import _ from 'lodash';

const WORKFLOW = "WORKFLOW";
const existingAttributeToKeep = [
    "id"
];

const exportWorkflows = async (apiConfig) => {
    const workflowsApi = new WorkflowsApi(apiConfig);
    const workflows = await Paginator.paginate(workflowsApi, workflowsApi.listWorkflows, { limit: 1000 }, 250);
    for (const workflow of workflows.data) {
        writeConfigFile(WORKFLOW, workflow.name, workflow);
    }
}

const migrateWorkflow = async (apiConfig, workflowJson) => {
    //Using /beta/workflows here because /v3 seems to fail for no reason
    const workflowsApi = new WorkflowsBetaApi(apiConfig);
    let localWorkflow = JSON.parse(workflowJson);
    console.log(clc.bgBlueBright(`Migrating workflow: ${localWorkflow.name}`));

    //Get corresponding owner by name and add id
    const owner = await getIdentityByName(apiConfig, _.get(localWorkflow, "owner.name"));
    _.set(localWorkflow, "owner.id", owner.id);

    //Get corresponding creator by name and add id
    const creator = await getIdentityByName(apiConfig, _.get(localWorkflow, "creator.name"));
    _.set(localWorkflow, "creator.id", creator.id);

    //Get corresponding modified by name and add id
    const modifiedBy = await getIdentityByName(apiConfig, _.get(localWorkflow, "modifiedBy.name"));
    _.set(localWorkflow, "modifiedBy.id", modifiedBy.id);

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
        console.log(`Creating new workflow for: ${localWorkflow.name}`);
        const createWorkflowResponse = await workflowsApi.createWorkflow({
            createWorkflowRequestBeta: {
                name: localWorkflow.name,
                owner: localWorkflow.owner,
                definition: localWorkflow.definition,
                description: localWorkflow.description,
                enabled: localWorkflow.enabled,
                trigger: localWorkflow.trigger
            }
        });
        currentTargetWorkflow = createWorkflowResponse.data;
    } else {
        console.log(`Found existing workflow in target environment: ${currentTargetWorkflow.name} (${currentTargetWorkflow.id})`)

        //Restore attributes from the currently deployed target workflow into our template workflow
        for (const workflowKey of existingAttributeToKeep) {
            _.set(localWorkflow, workflowKey, _.get(currentTargetWorkflow, workflowKey));
        }

        //Update the workflow with all config, references, etc.
        console.log(`Workflow JSON to be deployed:\n ${JSON.stringify(localWorkflow, null, 4)}`);
        await workflowsApi.putWorkflow({
            id: localWorkflow.id,
            workflowBody: localWorkflow
        });
    }
}

export {
    exportWorkflows,
    migrateWorkflow
};