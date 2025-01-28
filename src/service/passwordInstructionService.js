import clc from "cli-color";
import * as fs from "fs";
import { CustomPasswordInstructionsBetaApi } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, walk, writeConfigFile } from "../util.js";

const PASSWORD_INSTRUCTION = "PASSWORD_INSTRUCTION";
const availablePageIds = [
    "change-password:enter-password",
    "change-password:finish",
    "flow-selection:select",
    "forget-username:user-email",
    "mfa:enter-code",
    "mfa:enter-kba",
    "mfa:select",
    "reset-password:enter-password",
    "reset-password:enter-username",
    "reset-password:finish",
    "unlock-account:enter-username",
    "unlock-account:finish"
];

const exportPasswordInstructions = async (apiConfig) => {
    winston.info(clc.bgBlueBright("Starting Password Instruction Export"));

    /*
     * There is no endpoint for getting all custom password instructions, so we need to
     * pass each available pageId one by one and whatever one does not return a 404 can
     * be written as a config file. If custom customInstructionsEnabled is not enabled via
     * beta/password-org-config, then we will get a 400 for all of them which we also account for
     * 
    */
    const customPasswordInstructionsApi = new CustomPasswordInstructionsBetaApi(apiConfig);
    for (const pageId of availablePageIds) {
        try {
            const customPasswordInstructionsResponse = await customPasswordInstructionsApi.getCustomPasswordInstructions({
                pageId: pageId
            });
            winston.info(`Exporting Password Instruction for pageId: ${pageId}`);
            writeConfigFile(PASSWORD_INSTRUCTION, pageId, customPasswordInstructionsResponse.data);
        } catch (error) {
            if (error.response.status !== 404 && error.response.status !== 400) {
                handleHttpException(error);
            }
        }
    }
}

const migratePasswordInstructions = async (apiConfig, targetEnvName) => {
    winston.info(clc.bgBlueBright("Starting Password Instruction Deployment"));
    const customPasswordInstructionsApi = new CustomPasswordInstructionsBetaApi(apiConfig);
    const passwordInstructionFilePaths = walk("./build/config/PASSWORD_INSTRUCTION");

    for (const passwordInstructionFilePath of passwordInstructionFilePaths) {
        const passwordInstructionSource = fs.readFileSync(passwordInstructionFilePath);
        const localPasswordInstructionSource = JSON.parse(passwordInstructionSource);

        winston.info(`Updating Password Instruction for pageId: ${localPasswordInstructionSource.pageId}`);

        try {
            await customPasswordInstructionsApi.createCustomPasswordInstructions({
                customPasswordInstructionBeta: localPasswordInstructionSource
            });
        } catch (error) {
            handleHttpException(error);
        }
    }
    winston.info(clc.bgGreen("Completed Password Instruction Deployment"));
}

export {
    exportPasswordInstructions,
    migratePasswordInstructions
};

