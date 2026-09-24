import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import {
  initializeSentry,
  setupSentryMiddleware,
  setupSentryErrorHandler,
  errorHandlerMiddleware,
} from "@dotevolve/error-utils";
import courseRoutes from "./routes/courses";
import taxonomyRoutes from "./routes/taxonomies";
import interestRoutes from "./routes/interests";
import enrollmentRoutes from "./routes/enrollments";
import verifyRoutes from "./routes/verify";
import metricsRoutes from "./routes/metrics";
import auditLogsRoutes from "./routes/auditLogs";
import contactRoutes from "./routes/contact";
import enquiryRoutes from "./routes/enquiries";
import trainingPlanRoutes from "./routes/trainingPlan";
import settingsRoutes from "./routes/settingsRoutes";
import { globalLimiter } from "./middleware/rateLimiter";

// Initialize Sentry if DSN is provided
initializeSentry({
  dsn: process.env.SENTRY_DSN || "",
  environment: process.env.NODE_ENV || "development",
  release: "perfxcel-api@1.0.0",
  serviceName: "perfxcel-api",
});

const app = express();

// Security and Logging Middlewares
app.use(helmet());

const allowedOrigins = process.env.PERFXCEL_CORS_ORIGINS?.split(",").map((o) =>
  o.trim(),
) || [
  "https://perfxcel.com",
  "https://www.perfxcel.com",
  "https://admin.perfxcel.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        return callback(
          new Error(
            "The CORS policy for this site does not allow access from the specified Origin.",
          ),
          false,
        );
      }
      return callback(null, true);
    },
  }),
);

app.use(morgan("dev"));
app.use(express.json());
app.use(globalLimiter);

// Sentry Request Handler must be the first middleware on the app
setupSentryMiddleware(app);

// Health Check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "perfxcel-api" });
});

// API Routes
app.use("/api/v1/courses", courseRoutes);
app.use("/api/v1/taxonomies", taxonomyRoutes);
app.use("/api/v1/interests", interestRoutes);
app.use("/api/v1/enrollments", enrollmentRoutes);
app.use("/api/v1/verify", verifyRoutes);
app.use("/api/v1/metrics", metricsRoutes);
app.use("/api/v1/audit-logs", auditLogsRoutes);
app.use("/api/v1/contact", contactRoutes);
app.use("/api/v1/enquiries", enquiryRoutes);
app.use("/api/v1/training-plan", trainingPlanRoutes);
app.use("/api/v1/settings", settingsRoutes);

// Sentry Error Handler must be before any other error middleware and after all controllers
setupSentryErrorHandler(app);

// General Error Handler
app.use(errorHandlerMiddleware);

export default app;
