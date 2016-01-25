var AWS = require('aws-sdk');
var apiVersion = "2015-10-01";
var results = {};
var semaphore = { "describe": 0, "terminate": 0};	// A quick and CPU cheap way to enforce asynchronous signaling (essentially a Promise)

/**
 * The "main" function which AWS Lambda executes.
 */
exports.handler = function(event, context) {
    // Corner cases in which Lambda ought not to run
    if(!event.region) { announce(null, "No region(s) specified."); context.fail(event); return; }
    if(event.region.length === 0) { announce(null, results); context.succeed(results); return; }

    // For each region specified in the event...
    for(var i = 0; i < event.region.length; i++) {
        semaphore.describe++;
        var region = event.region[i];
        var ec2 = new AWS.EC2({region:region, apiVersion:apiVersion});
        var request = ec2.describeInstances({DryRun:false});

        // On a successful describe, execute the following callback
        request.on("success", function(response) {
            var region = response.request.service.config.region;
            var data = response.data;
            var ids = [];
            for(var i = 0; i < data.Reservations.length; i++) {
                var Instances = data.Reservations[i].Instances;
                for(var j = 0; j < Instances.length; j++) {
                    var instance = Instances[j];
                    if(isTagless(instance))
                        ids.push(instance.InstanceId);
                }
            }
            announce(region, ids);

            // If some Instances have been identified, attempt to terminate
            if(ids.length > 0) {
                semaphore.terminate++;
                var ec2 = new AWS.EC2(response.request.service.config);
                var request = ec2.terminateInstances({DryRun:true, InstanceIds:ids});	// Defaulting to DryRun true when terminating Instances

                // Callback for successful terminate
                request.on("success", function(response) {
                    var region = response.request.service.config.region;
                    var body = JSON.stringify(response.data);
                    results[region] = response.data;
                    announce(region, body);
                });

                // Callback for error terminate
                request.on("error", cbError);

                // Callback when terminating attempt has finished, successful or not -- decrement the terminate semaphore and check if finished
                request.on("complete", function() {
                    semaphore.terminate--;
                    if(describingDone() && terminatingDone()) {
                        context.succeed(results);
                    }
                });

                request.send();	// Issue the terminate request

            }
        });

        // Callback for error describe
        request.on("error", cbError);

        // Callback when describing attempt has finished, successful or not -- decrement the describe semaphore and check if finished
        request.on("complete", function() {
            semaphore.describe--;
            if(describingDone() && terminatingDone()) {
                context.succeed(results);
            }
        });

        request.send();	// Issue the describe request
    }
};

/**
 * A simple logging function used for printing to AWS Lambda logs.
 */
function announce(region, message) {
    if(region !== null) { d = "=========="; console.log(d + " " + region + " " + d); }
    console.log(message);
}
/**
 * Generic callback used for error responses.
 */
function cbError(error, response) {
    results[response.request.service.config.region] = error;
    announce(response.request.service.config.region, JSON.stringify(error));
}
/**
 * Return true if all describing calls are finished, false otherwise.
 */
function describingDone() {
    if(isDone(semaphore.describe)) { return true; }
    return false;
}
/**
 * Return true if all terminating calls are finished, false otherwise.
 */
function terminatingDone() {
    if(isDone(semaphore.terminate)) { return true; }
    return false;
}
function isDone(counter) {
    return counter === 0;
}
/**
 * Return true if a given Instance is considered tagless, false otherwise.
 */
function isTagless(instance) {
    try {
        if(!instance.Tags || instance.Tags.length === 0) { return true; }
        if(instance.Tags.length == 1)
            if(instance.Tags[0].Key == "Name" && instance.Tags[0].Value === "")
                return true;
    } catch(e) {}
    return false;
}
