# Identity Security Cloud Object Deploy Tool
The Identity Security Cloud Object Deploy Tool is a NodeJS command-line utility that allows you to export configuration objects such as Sources, Transforms, Rules, and more out of one Identity Security Cloud environment and import/deploy them to other Identity Security Cloud environments. It utilizes various v3/beta API endpoints to perform all export and import operations. One of the main benefits from using this tool is the ability to maintain single configuration objects that can be deploy to any environment via tokenization. This allows Source Code Management to actually make sense for ISC implementations and this process could easily be plugged into a CI/CD pipeline.

It offers the following features:
- Export objects and perform reverse-tokenization via JSONPath which replaces actual setting values with a token in the format of `%%TOKEN_NAME%%`. This allows a single object to be maintained in a code repository which can be "built" for any Identity Security Cloud environment
- Tokenize and build objects for a target Identity Security Cloud environment to validate tokenization before deployment which is the process of replacing the repository tokens with actual setting values which are needed for a specific environment (i.e. IQService host for an Active Directory Source)
- Tokenize and deploy objects to a target Identity Security Cloud environment

## Supported Object Types
The following object types are currently supported for export/deploy:
- RULE (connector rules + already approved cloud rules)
- TRANSFORM
- SOURCE (includes correlation config, schemas, and provisioning policies. **Does not include password policy references**)
- SERVICE_DESK_INTEGRATION
- IDENTITY_OBJECT_CONFIG
- IDENTITY_PROFILE (includes lifecycle states tied to the identity profile. **Does not include security settings**)
- ACCESS_REQUEST_CONFIG
- NOTIFICATION_TEMPLATE
- WORKFLOW
- GOVERNANCE_GROUP
- BRANDING_CONFIG
- PASSWORD_POLICY

## Setup/Import Configuration Files
This a NodeJS project that was written on NodeJS 18. You will need NodeJS installed prior to using this tool. Find the latest NodeJS download here: https://nodejs.org/en/download

You can then clone this repository. Once the repository is cloned, run `npm install` within the cloned repository directory to install all project dependencies.

You will also need to set up the following files in the root of your project to be able to export/import from Identity Security Cloud environments:
- `<env>.env.js` - Holds the parameters needed to login to hit ISC API endpoints via a PAT (Personal Access Token). These files is in the default `.gitignore` and should never be pushed to the remote repository. There is an example in this repository, but it needs to look like this:
```js
export default
    {
        baseurl: "https://<env>.api.identitynow.com",
        clientId: "id1234",
        clientSecret: "secret1234",
        tokenUrl: "https://<env>.api.identitynow.com/oauth/token",
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
- `<env>.target.js` - Contains entries where the key is the token in your config files (which is put there manually or by reverse-tokenization) and the value is the specific value for that token that you want to be deployed to a target Identity Security Cloud environment when running the `deploy` command
```js
export default
    {
        "%%AD_OWNER_ID%%": "ABCD1234",
        "%%AD_IQSERVICE_PORT%%": "888888",
    }
```
- `<env>.secrets.js` - Contains entries where the key is the token in your config files (which is put there manually or by reverse-tokenization) and the value is the plaintext secret/password for that token that you want to be deployed to a target Identity Security Cloud environment when running the `deploy` command. **These files are in the default .gitignore and should never be commmitted to the remote repository. This should only be used if you do not want to manually encrypt a password in a target environment so you can have the encrypted version of a secret to put into the `<env>.target.js` file**
```js
export default
    {
        "%%AD_OWNER_ID%%": "ABCD1234",
        "%%AD_IQSERVICE_PORT%%": "888888",
    }
```
- `export-ignore.js` - Contains an array of specific objects to ignore (not write to local config directory) when performing an export. Each entry must be in this specific format: `OBJECT_TYPE:Object Name`. If a file exists in your local `./config` directory and is then later added to this file, it will be deleted on the next export run See examples below:
```js
export default
    [
        "TRANSFORM:identityDisplayName",
        "SOURCE:TestAD"
    ]
```

## Config Directory Structure
When the export command is run, it will automatically created a directory in the root of the project called `/config`. This is where all of the configuration JSON files from the export will be stored. It will look like this:
```
config
 ┣ ACCESS_REQUEST_CONFIG
 ┃ ┗ ACCESS_REQUEST_CONFIG.json
 ┣ BRANDING_CONFIG
 ┃ ┗ BRANDING_CONFIG.json
 ┣ GOVERNANCE_GROUP
 ┣ IDENTITY_OBJECT_CONFIG
 ┃ ┗ IDENTITY_OBJECT_CONFIG.json
 ┣ IDENTITY_PROFILE
 ┃ ┣ HR
 ┃ ┃ ┣ LIFECYCLE_STATE
 ┃ ┃ ┃ ┣ Active.json
 ┃ ┃ ┃ ┗ Inactive.json
 ┃ ┃ ┗ HR.json
 ┣ NOTIFICATION_TEMPLATE
 ┣ RULE
 ┣ SOURCE
 ┃ ┣ Active Directory
 ┃ ┃ ┣ ATTR_SYNC_SOURCE_CONFIG
 ┃ ┃ ┃ ┗ Active Directory_ATTR_SYNC.json
 ┃ ┃ ┣ CONNECTOR_SCHEMA
 ┃ ┃ ┃ ┣ account.json
 ┃ ┃ ┃ ┣ group.json
 ┃ ┃ ┃ ┗ sharedMailbox.json
 ┃ ┃ ┣ CORRELATION_CONFIG
 ┃ ┃ ┃ ┗ Active Directory [source] Account Correlation.json
 ┃ ┃ ┣ PROVISIONING_POLICY
 ┃ ┃ ┃ ┣ Account_CREATE.json
 ┃ ┃ ┗ Active Directory.json
 ┣ TRANSFORM
 ┗ WORKFLOW
```
As you can see, some more complex object types such as sources will have subdirectories for directly referenced objects such as schemas. This structure helps to keep everything conveniently organized and it is very important to keep this format as is for the deploy/import process. Files should not be moved unless you know what you are doing.

When the `deploy` command is run, an additional directory will be created in the root of the project called `/build`. It will contain all built/tokenized objects that are going to be deployed to the target environment. It will be cleaned up every time the `deploy` command is run. You can view the built objects to view what was deployed to a target environment

## Commands
Once you have all the pre-requisites above setup, you can now start running some commands. Open up your favorite terminal and navigate to your project location. Our `src/index.js` file is the main file that is run with NodejS. We can run the app with the following if we wanted
```
node src/index.js --export --detokenize
```
However, in the `package.json`, there are a number of scripts set up which make the commands slightly easier to run

> [!NOTE]
> Ensure you put the double dash (`--`) after the initial command and your arguments as documented below for each command

### Export
To export objects from a specific environment and perform reverse-tokenization based on properties defined in your `reverse.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`.

**NOTE:** The export process will overwrite any manual changes made in your `/config/` directory. This is why it is crucial to set up your reverse tokenization properties if you wish to retain a neutral object state that can be deployed to any target environment.
```
npm run export -- --src_env=<env>
```

All supported object types will be exported by default. To ignore exporting specific files, please see the information on the `export-ignore.js` file above.

### Build
To perform tokenization and build objects locally for specific target environment based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`. The built objects will reside in the `/build/config` directory
```
npm run build -- --target_env=<env>
```

### Deploy/Import
To perform tokenization and deploy/import into a specific target environment based on tokens defined in your `<env>.target.js` file, run the following where `<env>` is the actual name of your environment such as `sb`
```
npm run deploy -- --target_env=<env>
```

> [!NOTE]
> The deploy/import execution process will continue on most errors. Errors will be recorded in the terminal if encountered



## Logging
The commands above print out various logs by default to show progress, warnings, and errors. The default log priority is `info`. In order to print more verbose logs, pass the `--log_level` parameter. The following are valid log levels prioritized from highest to lowest:
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


## Configuration Object Guidelines
Follow these guidelines to ensure these object types are deployed successfully

### Secrets
Objects such as sources and service desk integrations contain encrypted secrets/passwords for connecting to applications. Plain text secrets are either entered through the UI or via API and when saved, they are automatically encrypted using SailPoint's backend encryption process. Additionally, you will be connecting to different environments of these downstream applications from different ISC environments (i.e. Non-Prod AD vs Prod AD). This means the encrypted secret value will differ per ISC environments. Passwords can be deployed via this build tool and there are two methods for doing that:
1. Tokenization of Encrypted Secrets - Encrypted secret values can simply be stored in your `<env>.target.js` file. The issue here is that you will need to have those encrypted secret values for all environments. For example, if you onboard a source into your sandbox ISC environment which connects to a non-prod downstream application where in your production ISC tenant it will be connecting to the production instance of that downstream application, before you can deploy that new source to production ISC for the first time, you need the encrypted secret value. One way to do this would to create a dummy source in your production ISC tenant and provide the password in a password/secret field, save the source, and then fetch the encrypted value via API/VSCode/etc. and then plug that value into the appropriate token for that secret in your repository
2. Plaintext Secrets via Separate Secret Tokens - Another less-secure option this tool provides is a separate tokens file named `<env>.secrets.js`. This has the same exact concept of your `<env>.target.js` file, but is only used to store plaintext secrets. These files would never be committed to a remote repository and would only be held by a trust member of the team who is running the build process. The plaintext passwords would be provided when creating/updating objects via API calls and would be automatically encrypted by ISC

### Branding
In order to deploy a branding logo image, you must create a directory in the root of the project called `./assets`. This directory will contain your logo images in `.png` format only. The name of each png image should match the name of your target environment (`--target_env`) that you provide in the `deploy` command, for example: `prod.png`.


## Configuration Object Special Considerations
### Owner References
There are many objects throughout ISC that have owner references which point to an identity that have created an object, modified an object, etc. It is very important that owners are properly set up in exported configuration objects.

By default, you will see owner references contain a `type` which is always set to `IDENTITY`, an `id` which points to a very environment specific `id` for the identity that owns the objects (this is actually omitted during the export process), and lastly a `name` which is more of a soft reference that points to the owning identity. The `name` value can very between different object types, but is most often the `displayName` of an identity which is not ideal and does not guarantee a unique identity when looking up an identity by this name during migration to other environments. The only unique soft reference attribute on identities that guarantee a unique lookup is the `alias` attribute. **When you run the export process, objects with owner references will automatically have the `name` property value written as the owning identity's `alias` as opposed to their `displayName`.** This will allow us to perform unique identity lookups when migrating objects with owners to another environment. If an identity with that alias does not exist, the migration import will fail.  If you need different owners per environment because of preference or because an identity with a specific alias will not exist in the next environment, you will need to perform the following tokenization steps:
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

### Transforms
- During the export process, only non-internal (`"internal": false`) transforms are exported since internal transforms (maintained by SailPoint) cannot be changed
- If you are changing the `type` of a transform where that transform is already deployed to a target environment, the import will fail indicating that you cannot change the type. You must delete the transform in the target environment before you can be deployed with the name type, or else create a new transform with a different name and update all references

### Deleting Objects
There are two scenarios to consider when deleting objects:
- When objects are deleted directly inside of a tenant, they must also be removed in your build directory/repository because the export process does not consider cleaning up objects that may have been deleted in a tenant. If not cleaned up, they may be re-deployed inadvertently
- When objects are deleted from your build directory/repository, they will not automatically be cleaned up during the next build deployment. You must also delete objects directly in the tenant if you are removing them from your build repository



## Deploying to a Clean Environment
When you are deploying to a clean environment for the first time (i.e. first time from Sandbox to Production), there are a few pre-requisites/guidelines that need to be followed:
- A Virtual Appliance cluster needs to be configured. Virtual appliance cluster names will most likely be different, ensure to analyze all cluster references in sources, etc. and tokenized them as needed
- All owner references should be analyzed and tokenized as needed. Owner references may fail if not aggregations have occurred yet. You can use something like `slpt.services` as the default owner on objects to avoid this
- Source attribute sync configurations may failed to deploy initially if an identity profile with the corresponding identity attributes does not exist yet. There is no real workaround for this at the moment. Some identity profiles rely on sources to exist before being created, so we are prioritizing that over attribute sync. You must run another import after identity profiles are created to allow attribute sync configs to be updated properly



## Known Issues/Limitations
- Identity Profiles which reference transforms use a key named `id` with a value of the transform name. Because of this, some actual `id` references are not omitted from Identity Profile objects. It will not harm the migration/deployment process at all as those `id` references would be replaced with the proper target `id` anyways. A future enhancement could make this better
- When objects are exported and save to a file, the file name becomes the name of the object. Any special characters not allowed in file names will be replaced with a dash (`-`)
- Workflow secrets such as OAuth client secrets cannot be converted to the proper encrypted secrets as the endpoint requires a browser JWT token