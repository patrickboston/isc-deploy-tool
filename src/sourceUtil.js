import clc from "cli-color";
import { SourcesApi, Paginator } from "sailpoint-api-client";
import { writeConfigFile } from "./util.js";

/**
* Gets all sources via v3/sources and write appropriate 
* Source files and referenced objects
* @param {Configuration} apiConfig
*/
const exportSources = async (apiConfig) => {
    console.info(clc.bgBlueBright("Performing Source export"));
    const sourcesApi = new SourcesApi(apiConfig);

    const sources = await Paginator.paginate(sourcesApi, sourcesApi.listSources, { limit: 1000 }, 250);
    for (const source of sources.data) {
        let sourceClone = structuredClone(source);
        const sourceName = source.name;
        console.log(clc.bgCyan(`Processing export for source: ${sourceName}`));

        //Get and write referenced schemas on source
        const sourceSchemas = await sourcesApi.listSourceSchemas({ sourceId: source.id });
        for (const schema of sourceSchemas.data) {
            writeConfigFile("CONNECTOR_SCHEMA", schema.name, schema, "SOURCE/" + sourceName + "/CONNECTOR_SCHEMA");
        }

        //Get and write referenced policies on source
        const sourcePolicies = await sourcesApi.listProvisioningPolicies({ sourceId: source.id });
        for (const policy of sourcePolicies.data) {
            const policyFileName = policy.name + "_" + policy.usageType;
            writeConfigFile("PROVISIONING_POLICY", policyFileName, policy, "SOURCE/" + sourceName + "/PROVISIONING_POLICY");
        }

        //Write the actual source
        writeConfigFile("SOURCE", sourceName, source, "SOURCE/" + sourceName);
    }
};

export {
    exportSources,
};