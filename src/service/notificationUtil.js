import clc from "cli-color";
import _ from 'lodash';
import { NotificationsBetaApi, Paginator } from "sailpoint-api-client";
import { writeConfigFile } from "../util.js";

const NOTIFICATION_TEMPLATE = "NOTIFICATION_TEMPLATE";
const existingAttributeToKeep = [
    "id"
];

const exportNotificationTemplates = async (apiConfig) => {
    const notificationsBetaApi = new NotificationsBetaApi(apiConfig);
    const notificationTemplatesResponse = await Paginator.paginate(notificationsBetaApi, notificationsBetaApi.listNotificationTemplates, { limit: 1000 }, 250);
    for (const notificationTemplate of notificationTemplatesResponse.data) {
        writeConfigFile(NOTIFICATION_TEMPLATE, notificationTemplate.name, notificationTemplate);
    }
}

const migrateNotificationTemplate = async (apiConfig, templateJson) => {
    const notificationsBetaApi = new NotificationsBetaApi(apiConfig);

    let localTemplate = JSON.parse(templateJson);
    console.log(clc.bgBlueBright(`Migrating notification template: ${localTemplate.name}`));

    //Check and see if a template with this name already exists in the target environment
    const currentTemplateResponse = await notificationsBetaApi.listNotificationTemplates({
        filters: `name eq "${localTemplate.name}"`
    });
    let currentTargetTemplate = currentTemplateResponse.data.length == 1 ? currentTemplateResponse.data[0] : null;

    if (!currentTargetTemplate) {
        console.log(`Creating new notification template for: ${localTemplate.name}`);
        try {
            const createTemplateResponse = await notificationsBetaApi.createNotificationTemplate({
                templateDtoBeta: {
                    key: localTemplate.key,
                    locale: localTemplate.locale,
                    medium: localTemplate.medium,
                    body: localTemplate.body,
                    description: localTemplate.description,
                    from: localTemplate.from,
                    name: localTemplate.name,
                    replyTo: localTemplate.replyTo,
                    subject: localTemplate.subject
                }
            });
            currentTargetTemplate = createTemplateResponse.data;
        } catch (error) {
            await handleHttpException(error);
        }
    } else {
        console.log(`Found existing notification template in target environment: ${currentTargetTemplate.name} (${currentTargetTemplate.id})`)

        //Restore attributes from the currently deployed target template into our template template
        for (const templateKey of existingAttributeToKeep) {
            _.set(localTemplate, templateKey, _.get(currentTargetTemplate, templateKey));
        }

        //Update the template with all config, references, etc.
        //Create endpoint also updates templates
        try {
            await notificationsBetaApi.createNotificationTemplate({
                templateDtoBeta: {
                    id: currentTargetTemplate.id,
                    key: localTemplate.key,
                    locale: localTemplate.locale,
                    medium: localTemplate.medium,
                    body: localTemplate.body,
                    description: localTemplate.description,
                    from: localTemplate.from,
                    name: localTemplate.name,
                    replyTo: localTemplate.replyTo,
                    subject: localTemplate.subject
                }
            });
        } catch (error) {
            await handleHttpException(error);
        }
    }
}

export {
    exportNotificationTemplates,
    migrateNotificationTemplate
};
