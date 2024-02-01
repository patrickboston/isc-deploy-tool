import clc from "cli-color";
import { SourcesApi, Paginator } from "sailpoint-api-client";
import { writeConfigFile, writeConfigFileAsync } from "./util.js";

/**
* Gets all sources via v3/sources and write appropriate 
* Source files and referenced objects
* @param {Configuration} apiConfig
*/
const getSources = async (apiConfig) => {
    console.info(clc.bgBlueBright("Performing Source export"));
    const sourcesApi = new SourcesApi(apiConfig);

    const sources = await Paginator.paginate(sourcesApi, sourcesApi.listSources, { limit: 1000 }, 250);
    for (const source of sources.data) {
        let sourceClone = structuredClone(source);
        const sourceName = source.name;
        console.log(clc.bgCyan(`Processing export for source: ${sourceName}`));

        const sourceSchemas = await sourcesApi.listSourceSchemas({ sourceId: source.id });
        for (const schema of sourceSchemas.data) {
            console.info("WRITING SCHEMAS");
            writeConfigFile("CONNECTOR_SCHEMA", schema.name, schema, "SOURCE/" + sourceName + "/CONNECTOR_SCHEMA");
        }

        const sourcePolicies = await sourcesApi.listProvisioningPolicies({ sourceId: source.id });
        for (const policy of sourcePolicies.data) {
            console.info("WRITING POLICY");
            const policyFileName = policy.name + "_" + policy.usageType;
            writeConfigFile("PROVISIONING_POLICY", policyFileName, policy, "SOURCE/" + sourceName + "/PROVISIONING_POLICY");
        }

        console.info("WRITING MAIN SOURCE");
        writeConfigFile("SOURCE", sourceName, source, "SOURCE/" + sourceName);
    }
};

export {
    getSources,
};