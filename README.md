# IdentityNow Object Migration Tool
The IdentityNow Object Migration tool is a NodeJS command-line utility that allows you to export configuration objects such as Sources, Transforms, Rules, and more out of one IdentityNow environment and import/deploy them to other IdentityNow environments. It utilizes the [SP-Config API endpoints](https://developer.sailpoint.com/idn/api/beta/sp-config) to perform all export and import operations. One of the main benefits from using this tool is the ability to maintain single configuration objects that can be deploy to any environment via tokenization. This allows Source Code Management to actually make sense for IDN implementations and this process could easily be plugged into a CI/CD pipeline.

It offers the following features:
- Export objects as-is (raw) out of an environment
- Export objects and perform reverse-tokenization via JSONPath which replaces actual setting values with a token in the format of `%%TOKEN_NAME%%`. This allows a single object to be maintained in a code repository which can be "built" for any IdentityNow environment
- Tokenize and build objects for a target IdentityNow environment to validate tokenization before deployment which is the process of replacing the repository tokens with actual setting values which are needed for a specific environment (i.e. IQService host for an Active Directory Source)
- Tokenize and deploy objects to a target IdentityNow environment

If used properly, this tool can offer deployment workflows like the following:
1. Perform initial sandbox setup
2. Export objects you wish to be maintained in SCM and to be deployed to higher environments via this process
3. Replace configuration values with tokens in configuration files and set up reverse tokenization to retain tokens on subsequent tenant exports
4. Continue development in sandbox and export periodically, committing changes to a SCM repository. Changes could also be made directly in JSON configuration files in local repository and deployed back to an environment
5. Once configuration is fully exported, tokenized, and ready to deploy to another environment, use the deploy process

## Setup
This a NodeJS project that was written on NodeJS 18. You will need NodeJS installed prior to using this tool. Find the latest NodeJS download here: https://nodejs.org/en/download

You can then clone this repository. Once the repository is cloned, run `npm install` within the cloned repository directory to install all project dependencies.

You will also need to set up the following files in the root of your project to be able to export/import from IdentityNow environments:
- `<env>.env.js` - Holds the parameters needed to login to hit IDN API endpoints via a PAT (Personal Access Token). There is an example in this repository, but it needs to look like this:
```js
export default
    {
        baseurl: "https://<env>.api.identitynow-demo.com",
        clientId: "id1234",
        clientSecret: "secret1234",
        tokenUrl: "https://<env>.api.identitynow-demo.com/oauth/token",
    }
```
- `export-config.js` - Contains the JSON object that is needed for the SP-Config tenant export process to run. This is where you can pick and choose what exactly you want to be exported out of an environment. For more information, see the following: https://developer.sailpoint.com/idn/api/beta/export-sp-config/
```js
export default
    {
        "description": "Export Job",
        "excludeTypes": [
            
        ],
        "includeTypes": [
            "SOURCE"
        ],
        "objectOptions": {
            "SOURCE": {
                "includedIds": [
                ],
                "includedNames": [
                    "Active Directory"
                ]
            }
        }
    }
```
- `reverse.target.js` - Contains entries specific for each config file that you would want to perform reverse-tokenization on when running the `export` command. Each entry under config file contains a key for the JSONPath of where to replace the value with the token specified. Reverse-tokenization simply means replacing the value of an entry in an object that is exported with a common token which can be replaced with an actual value when deploying that object to another environment
```js
export default
    {
        "SOURCE/Active Directory.json": {
            "$.object.owner.id": "%%AD_OWNER_ID%%",
            "$.object.connectorAttributes.IQServicePort": "%%AD_IQSERVICE_PORT%%",
        }
    }
```
- `<env>.target.js` - Contains entries where the key is the token in your config files (which is put there manually or by reverse-tokenization) and the value is the specific value for that token that you want to be deployed to a target IdentityNow environment when running the `deploy` command
```js
export default
    {
        "%%AD_OWNER_ID%%": "ABCD1234",
        "%%AD_IQSERVICE_PORT%%": "888888",
    }
```

## Commands
Once you have all the pre-requisites above setup, you can now start running some commands. Open up your favorite terminal and navigate to your project location. Our `src/index.js` file is the main file that is run with NodejS. We can run the app with the following if we wanted
```
node src/index.js --export --detokenize
```
However, in the `package.json`, there are a number of scripts set up which make the commands slightly easier to run

> [!NOTE]
> Ensure you put the double dash (`--`) after the command initial command and your arguments as documented below for each command

### Export
To export objects from a specific environment and perform reverse-tokenization based on properties defined in your `reverse.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`. This process relies on the `export-config.js` file you have configured to determine which objects you want to export out of your source IdentityNow environment.

**NOTE:** The export process will overwrite any manual changes made in your `/config/` directory. This is why it is crucial to set up your reverse tokenization properties if you wish to retain a neutral object state that can be deployed to any target environment.
```
npm run export -- -src-env=<env>
```

### Build
To perform tokenization and build objects locally for specific target environment based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`. The built objects will reside in the `/build/config` directory
```
npm run build -- -target-env=<env>
```

### Deploy/Import
To perform tokenization and deploy/import into a specific target environment based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`
```
npm run deploy -- -target-env=<env>
```

> [!NOTE]
> The deploy/import execution process will continue on errors. Errors will be recorded in the terminal if encountered



## Logging
The commands above print out various logs by default. The default log priority is `info`. In order to print more verbose logs, pass the `--log_level` parameter. The following are valid log levels prioritized from highest to lowest:
```
error: 0
warn: 1
info: 2
http: 3
verbose: 4
debug: 5
silly: 6
```

Most of the more detailed logging (HTTP requests, etc. is available at the `debug` level).


## Configuration Object Special Considerations
### Owner References
There are many objects throughout IDN that have owner references which point to an identity that have created an object, modified an object, etc. It is very important that owners are properly set up in exported configuration objects.

By default, you will see owner references contain a `type` which is always set to `IDENTITY`, an `id` which points to a very environment specific `id` for the identity that owns the objects (this is actually omitted during the export process), and lastly a `name` which is more of a soft reference that points to the owning identity. The `name` value can very between different object types, but is most often the `displayName` of an identity which is not ideal and does not guarantee a unique identity when looking up an identity by this name during migration to other environments. The only unique soft reference attribute on identities that guarantee a unique lookup is the `alias` attribute. **When you run the export process, objects with owner references will automatically have the `name` property value written as the owning identity's `alias` as opposed to their `displayName`.** This will allow us to perform unique identity lookups when migrating objects with owners to another environment. If an identity with that alias does not exist, the migration import will fail.  If you need different owners per environment because of preference or because an identity with a specific alias will next exist in the next environment, you will need to perform the following tokenization steps:
1. Set up a reverse token in `reverse.target.js` for the object being exported. You could also hard code an identity alias here that will be the same owner across all environments instead of using a token
```json
{
    "SOURCE/Active Directory/Active Directory.json": {
        "$.owner.name": "%%AD_OWNER_ALIAS%%"
    }
}
```
2. For each `<env>.target.js` properties files, set up a corresponding token with a value that points to the `alias` attribute of the owning identity
```json
{
    "%%AD_OWNER_ALIAS%%": "03-1013143",
    "%%AD_IQSERVICE_PORT%%": "1111",
}
```

During the deployment process, the pipeline will attempt to find a corresponding identity by that alias via the `GET /beta/identities` endpoint get the unique `id` and insert it into the owner reference before deploying.

The following object types have owner references that will need to be considered during your implementation:
- ACCESS_REQUEST_CONFIG
- IDENTITY_PROFILE
- SOURCE
- WORKFLOW

### Lifecycle States
When lifecycle states are exported, access profile and source ID references will be replaced with the names of the object. This allows us to perform a lookup of the objects by name and dynamically populate the IDs from the target environment. **Make sure names are consistent across environments for this reason**.

### Workflows
- When workflows are being updated via the deployment process, if they are enabled, they will be temporarily disabled (1-2s) to perform the update, and then the enabled status defined in the workflow in the repository will be the final state the workflow ends up in. It will not be automatically enabled after update just because it was already enabled before we updated it with the pipeline.
- If your workflow has any secrets stored in it such as OAuth client secrets, when the workflow is saved via the UI, those secrets are encrypted and referenced via a special syntax (i.e. `$.secrets.d3b98a91-1060-471f-a255-fa8766eb56b5`). If you tokenize the actual secret values in your token files to be deployed, when you run the workflow it will error our saying the secret is not stored in the correct format as the secret with no be converted over to the other special encrypted format mentioned above until the workflow is saved from the UI again. To circumvent this, tokenize the special encrypted secret syntax (i.e. `$.secrets.d3b98a91-1060-471f-a255-fa8766eb56b5`), or after deployments you must go save the workflow in the UI again.

### Deleting Objects
There are two scenarios to consider when deleting objects:
- When objects are deleted directly inside of a tenant, they must also be removed in your build directory/repository because the export process does not consider cleaning up objects that may have been deleted in a tenant. If not cleaned up, they may be re-deployed inadvertently
- When objects are deleted from your build directory/repository, they will not automatically be cleaned up during the next build deployment. You must also delete objects directly in the tenant if you are removing them from your build repository





## Known Issues/Limitations
- Identity Profiles which reference transforms use a key named `id` with a value of the transform name. Because of this, some actual `id` references are not omitted from Identity Profile objects. It will not harm the migration/deployment process at all as those `id` references would be replaced with the proper target `id` anyways. A future enhancement could make this better
- When objects are exported and save to a file, the file name becomes the name of the object. Any special characters not allowed in file names will be replaced with a dash (`-`)
- Workflow secrets such as OAuth client secrets cannot be converted to the proper encrypted secrets as the endpoint requires a browser JWT token