import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { LaunchersBetaApi, Paginator, WorkflowsApi, WorkflowsBetaApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, replaceKeyValues, sleep, walk, writeConfigFile } from "../util.js";
import { getFormById, getFormByName } from "./formService.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";

const WORKFLOW = "WORKFLOW";
const existingAttributeToKeep = [
    "id"
];
//Cache of workflows we fetch during imports
let workflowCache = {};

const getWorkflowById = async (apiConfig, workflowId) => {
    if (workflowCache[workflowId]) return workflowCache[workflowId];

    const workflowsApi = new WorkflowsApi(apiConfig);
    const workflowResponse = await workflowsApi.getWorkflow({
        id: workflowId
    }).catch(error => {
        handleHttpException(error);
    });

    if (!workflowResponse) {
        throw new Error(`Could not find workflow for id [${workflowId}] in tenant: ${apiConfig.basePath}`)
    }
    workflowCache[workflowId] = workflowResponse.data;

    return workflowResponse.data;
}

const fetchFormNameReplacement = async (currentValue, apiConfig) => {
    winston.info(`Fetching workflow form reference by id: ${currentValue}`);
    const form = await getFormById(apiConfig, currentValue);
    return form.name;
};

const fetchFormIdReplacement = async (currentValue, apiConfig) => {
    winston.info(`Fetching workflow form reference by name: ${currentValue}`);
    const form = await getFormByName(apiConfig, currentValue);
    return form.id;
};

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

        //Replace formDefinitionId instances with the workflow name
        await replaceKeyValues(workflow, "formDefinitionId", fetchFormNameReplacement, apiConfig);

        /*
         * Handle External Triggers type name/id replacement
            "trigger": {
                "type": "EXTERNAL",
                "attributes": {
                    "clientId": "c7f33278-03f9-4a2a-b390-d02c1d9058f9",
                    "url": "/beta/workflows/execute/external/796857e8-5352-4e7d-9c98-fd2c97dce1ae"
                }
            }
        */
        if (workflow.trigger.type === "EXTERNAL" && workflow.trigger.attributes.url) {
            //Replace workflow id with name
            let externalUrl = workflow.trigger.attributes.url;
            const workflowId = externalUrl.split("/").pop();
            const workflowName = await getWorkflowById(apiConfig, workflowId);
            workflow.trigger.attributes.url = externalUrl.replace(workflowId, workflowName.name);
        }

        /*
         * Handle interactive launcher trigger type name/id replacement
            "trigger": {
            "type": "EVENT",
            "attributes": {
                "filter.$": "$[?(@.workflowId == '796857e8-5352-4e7d-9c98-fd2c97dce1ae')]",
                "id": "idn:interactive-process-launched"
            }
        }
        */
        if (workflow.trigger.attributes.id === "idn:interactive-process-launched") {
            workflow.trigger.attributes["filter.$"] = workflow.trigger.attributes["filter.$"].replace(workflow.id, workflow.name);
        }

        /*
         * Handle form submitted trigger type name/id replacement
            "trigger": {
            "type": "EVENT",
            "attributes": {
                "filter.$": "$[?(@.formDefinitionId == '0d8fa517-b337-4d12-ad64-53d520c21d1b')]",
                "formDefinitionId": "0d8fa517-b337-4d12-ad64-53d520c21d1b",
                "id": "sp:form-submitted"
            }
        }
        */
        if (workflow.trigger.attributes.id === "sp:form-submitted") {
            let filterString = workflow.trigger.attributes["filter.$"];
            //Regular expression to match the workflow id between the two single quotes
            const betweenQuotesRegex = /'([^']*)'/;
            const match = filterString.match(betweenQuotesRegex);

            if (match) {
                const formId = match[1];
                const form = await getFormById(apiConfig, formId);
                filterString = filterString.replace(formId, form.name);
                workflow.trigger.attributes["filter.$"] = filterString;
            }
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

    //Replace formDefinitionId instances with the workflow id
    await replaceKeyValues(localWorkflow, "formDefinitionId", fetchFormIdReplacement, apiConfig);

    //Handle form submitted trigger type name/id replacement
    if (localWorkflow.trigger.attributes.id === "sp:form-submitted") {
        let filterString = localWorkflow.trigger.attributes["filter.$"];
        //Regular expression to match the workflow id between the two single quotes
        const betweenQuotesRegex = /'([^']*)'/;
        const match = filterString.match(betweenQuotesRegex);

        if (match) {
            //Because this is the local version, should be a name reference
            const formName = match[1];
            const form = await getFormByName(apiConfig, formName);
            filterString = filterString.replace(formName, form.id);
            localWorkflow.trigger.attributes["filter.$"] = filterString;
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

            //After initial create, if this is an interactive process trigger, we need to update the filter with the new workflow id
            if (localWorkflow.trigger.attributes.id === "idn:interactive-process-launched") {
                const newFilterValue = localWorkflow.trigger.attributes["filter.$"].replace(localWorkflow.name, currentTargetWorkflow.id);
                //Patch workflow to update the filter
                try {
                    await workflowsApi.patchWorkflow({
                        id: currentTargetWorkflow.id,
                        jsonPatchOperationBeta: [
                            {
                                op: "replace",
                                path: "/trigger/attributes/filter.$",
                                value: newFilterValue
                            }
                        ]
                    });
                } catch (error) {
                    await handleHttpException(error);
                }

                //Create the interactive trigger entitlement via beta/launchers (only for new, assume it exists if workflow is updated)
                winston.info(`Creating interactive trigger entitlement for new workflow: ${localWorkflow.name}`);
                const launchersApi = new LaunchersBetaApi(apiConfig);
                try {
                    await launchersApi.createLauncher({
                        launcherRequestBeta: {
                            config: "{}",
                            description: localWorkflow.description,
                            disabled: true,
                            name: localWorkflow.name,
                            type: "INTERACTIVE_PROCESS",
                            reference: {
                                id: currentTargetWorkflow.id,
                                type: "WORKFLOW"
                            }
                        }
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            }

            //If external trigger, need to update the URL to use the version with the ID
            if (localWorkflow.trigger.type === "EXTERNAL" && localWorkflow.trigger.attributes.url) {
                //Use currently deployed URL
                const newExternalUrl = localWorkflow.trigger.attributes.url.replace(localWorkflow.name, currentTargetWorkflow.id);

                //Patch workflow to update the url
                try {
                    await workflowsApi.patchWorkflow({
                        id: currentTargetWorkflow.id,
                        jsonPatchOperationBeta: [
                            {
                                op: "replace",
                                path: "/trigger/attributes/url",
                                value: newExternalUrl
                            }
                        ]
                    });
                } catch (error) {
                    await handleHttpException(error);
                }
            }

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

        //If external trigger, need to update the URL to use the version with the ID
        if (currentTargetWorkflow.trigger.type === "EXTERNAL" && currentTargetWorkflow.trigger.attributes.url) {
            //Use currently deployed URL
            localWorkflow.trigger.attributes.url = currentTargetWorkflow.trigger.attributes.url;
        }

        //Interactive trigger needs the currently deployed trigger value which contains the workflow's id
        if (localWorkflow.trigger.attributes.id === "idn:interactive-process-launched") {
            localWorkflow.trigger.attributes["filter.$"] = currentTargetWorkflow.trigger.attributes["filter.$"];
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
    exportWorkflows, getWorkflowById, migrateWorkflow,
    migrateWorkflows
};

