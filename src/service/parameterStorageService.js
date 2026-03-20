import clc from "cli-color";
import * as fs from "fs";
import _ from "lodash";
import { Paginator, ParameterStorageV2025Api } from "sailpoint-api-client";
import winston from "winston";
import { handleHttpException, walk, writeConfigFile } from "../util.js";

const PARAMETER_STORAGE = "PARAMETER_STORAGE";
const existingAttributeToKeep = ["id"];
//Cache of parameters we fetch during imports
let parameterStorageCache = {};

const getParameterStorageById = async (apiConfig, parameterId) => {
    if (parameterStorageCache[parameterId]) return parameterStorageCache[parameterId];

    const parameterStorageApi = new ParameterStorageV2025Api(apiConfig);
    const parameterResponse = await parameterStorageApi
        .getParameter(
            { id: parameterId },
            {
                headers: {
                    "X-SailPoint-Experimental": "true",
                },
            }
        )
        .catch(error => {
            handleHttpException(error);
        });

    if (!parameterResponse) {
        throw new Error(`Could not find parameter storage for id [${parameterId}] in tenant: ${apiConfig.basePath}`);
    }
    parameterStorageCache[parameterId] = parameterResponse.data;

    return parameterResponse.data;
};

const getParameterStorageByName = async (apiConfig, parameterName) => {
    if (parameterStorageCache[parameterName]) return parameterStorageCache[parameterName];

    const parameterStorageApi = new ParameterStorageV2025Api(apiConfig);
    const parameterResponse = await parameterStorageApi
        .searchParameters(
            { filters: `name eq "${parameterName}"`, limit: 1 },
            {
                headers: {
                    "X-SailPoint-Experimental": "true",
                },
            }
        )
        .catch(error => {
            handleHttpException(error);
        });

    if (!parameterResponse || parameterResponse.data.length === 0) {
        throw new Error(
            `Could not find parameter storage for name [${parameterName}] in tenant: ${apiConfig.basePath}. You need to create it manually in the target tenant before the referenced object can be created/updated`
        );
    }
    parameterStorageCache[parameterName] = parameterResponse.data;

    return parameterResponse.data[0];
};

export { getParameterStorageById, getParameterStorageByName };
