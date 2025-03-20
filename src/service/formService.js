import clc from "cli-color";
import * as fs from "fs";
import _ from 'lodash';
import { CustomFormsBetaApi, Paginator } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, sleep, walk, writeConfigFile } from "../util.js";
import { getIdentityByAlias, getIdentityById } from "./identityService.js";

const FORM = "FORM_DEFINITION";
const existingAttributeToKeep = [
    "id"
];
//Cache of forms we fetch during imports
let formCache = {};

const getFormById = async (apiConfig, formId) => {
    if (formCache[formId]) return formCache[formId];

    const formsApi = new CustomFormsBetaApi(apiConfig);
    const formsResponse = await formsApi.getFormDefinitionByKey({
        formDefinitionID: formId
    }).catch(error => {
        handleHttpException(error);
    });

    if (!formsResponse) {
        throw new Error(`Could not find form for id [${formId}] in tenant: ${apiConfig.basePath}`)
    }
    formCache[formId] = formsResponse.data;

    return formsResponse.data;
}

const getFormByName = async (apiConfig, formName) => {
    if (formCache[formName]) return formCache[formName];

    const formsApi = new CustomFormsBetaApi(apiConfig);
    const formsResponse = await formsApi.exportFormDefinitionsByTenant({
        filters: `name eq "${formName}"`
    }).catch(error => {
        handleHttpException(error);
    });

    if (!formsResponse || formsResponse.data.length === 0) {
        throw new Error(`Could not find form for name [${formName}] in tenant: ${apiConfig.basePath}`)
    }
    formCache[formName] = formsResponse.data[0].object;

    return formsResponse.data[0].object;
}

const exportForms = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Form Export"));
    const formsApi = new CustomFormsBetaApi(apiConfig);
    const formsResponse = await Paginator.paginate(formsApi, formsApi.exportFormDefinitionsByTenant, undefined, 250).catch(error => {
        handleHttpException(error);
    });
    /* 
     * They get exported in sp-config format like identity profile export,
     * but we will store just the object itself so we can use the other normal create/update endpoints
     * For some reason the SDK does not have the normal GET endpoint, just the sp-config one is available
    */
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

    //Check and see if a form with this name already exists in the target environment
    const currentFormsResponse = await formsApi.exportFormDefinitionsByTenant({
        filters: `name eq "${localForm.name}"`
    });
    let currentTargetForm = currentFormsResponse.data.length == 1 ? currentFormsResponse.data[0].object : null;

    if (!currentTargetForm) {
        winston.info(`Creating new form: ${localForm.name}`);
        try {
            const createFormResponse = await formsApi.createFormDefinition({
                createFormDefinitionRequestBeta: {
                    name: localForm.name,
                    description: localForm.description,
                    owner: localForm.owner,
                    formConditions: localForm.formConditions,
                    formElements: localForm.formElements,
                    formInput: localForm.formInput,
                    formButtons: localForm.formButtons,
                    usedBy: localForm.usedBy
                }
            });
            currentTargetForm = createFormResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        winston.info(`Updating existing form: ${localForm.name} (${currentTargetForm.id})`);
        //Restore attributes from the currently deployed target object into our template object
        for (const key of existingAttributeToKeep) {
            _.set(localForm, key, _.get(currentTargetForm, key));
        }

        //Need to build carefully since it will not accept empty arrays, etc.
        const patchOperations = [
            {
                op: "replace",
                path: "/name",
                value: localForm.name
            },
            {
                op: "replace",
                path: "/description",
                value: localForm.description
            },
            {
                op: "replace",
                path: "/owner",
                value: localForm.owner
            },
        ];

        //Add in optional forms components if they exist
        patchOperations.push(
            {
                op: "replace",
                path: "/formConditions",
                value: localForm.formConditions ? localForm.formConditions : []
            }
        )

        patchOperations.push(
            {
                op: "replace",
                path: "/formElements",
                value: localForm.formElements ? localForm.formElements : []
            }
        )

        patchOperations.push(
            {
                op: "replace",
                path: "/formInput",
                value: localForm.formInput ? localForm.formInput : []
            }
        )

        patchOperations.push(
            {
                op: "replace",
                path: "/formButtons",
                value: localForm.formButtons ? localForm.formButtons : []
            }
        )

        patchOperations.push(
            {
                op: "replace",
                path: "/usedBy",
                value: localForm.usedBy ? localForm.usedBy : []
            }
        )

        try {
            await formsApi.patchFormDefinition({
                formDefinitionID: currentTargetForm.id,
                body: patchOperations
            })
        } catch (error) {
            await handleHttpException(error);
        }
    }
}

const migrateForms = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Form Deployment"));
    //Only read one directory down where main source files are
    const formFilePaths = walk("./build/config/FORM_DEFINITION");

    //Iterate each form and pass it to migrateSource
    for (const formFilePath of formFilePaths) {
        const form = fs.readFileSync(formFilePath);
        await migrateForm(apiConfig, form);
    }
    winston.info(clc.bgGreen("Completed Form Deployment"));
}

export {
    exportForms,
    migrateForm,
    migrateForms,
    getFormById,
    getFormByName
};

