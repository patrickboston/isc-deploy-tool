import { default as exportConfig } from "./../export-config.js";
import { default as reverseTokens } from "./../reverse.target.js";
import * as fs from "fs";
import _ from 'lodash';
import clc from "cli-color";
import { JSONPath } from "jsonpath-plus";
import { SPConfigBetaApi, SourcesApi, Paginator } from "sailpoint-api-client";


const getSources = async (apiConfig) => {
    console.info(clc.bgBlueBright("Performing tenant export"));
    return new Promise((resolve, reject) => {
        let sourcesApi = new SourcesApi(apiConfig);

        const val = Paginator.paginate(sourcesApi, sourcesApi.listSources, {limit: 1000}, 250)
        resolve(val);
    })
}

export {
    getSources
};