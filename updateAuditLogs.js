const fs = require("fs");
const glob = require("glob");

const files = glob.sync("src/controllers/*Controller.ts");

files.forEach((file) => {
  let content = fs.readFileSync(file, "utf8");

  // Replace all with actorType: "user"
  content = content.replace(
    /await logAuditEvent\(\{/g,
    'await logAuditEvent({\n    actorType: "user",',
  );

  // Now fix the specific service ones
  // 1. enquiryController - submitContact
  if (file.includes("enquiryController.ts")) {
    content = content.replace(
      /actorType: "user",\s+tenantId: tenantId,\s+action: "ENQUIRY_SUBMITTED"/g,
      'actorType: "service",\n    tenantId: tenantId,\n    action: "ENQUIRY_SUBMITTED"',
    );
  }

  // 2. courseController - registerInterest
  if (file.includes("courseController.ts")) {
    content = content.replace(
      /actorType: "user",\s+tenantId: tenantId,\s+action: "INTEREST_REGISTERED"/g,
      'actorType: "service",\n    tenantId: tenantId,\n    action: "INTEREST_REGISTERED"',
    );
  }

  // 3. trainingPlanController - requestTrainingPlan
  if (file.includes("trainingPlanController.ts")) {
    content = content.replace(
      /actorType: "user",\s+tenantId: tenantId,\s+action: "TRAINING_PLAN_REQUESTED"/g,
      'actorType: "service",\n    tenantId: tenantId,\n    action: "TRAINING_PLAN_REQUESTED"',
    );
  }

  fs.writeFileSync(file, content);
});

console.log("Done updating audit logs");
