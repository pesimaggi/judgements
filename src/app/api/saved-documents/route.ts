import { authenticatedUserId, clerkConfigured } from "@/lib/auth/clerk";
import { prisma } from "@/lib/db";
import { savedDocumentHandlers } from "@/lib/saved-documents";

export const dynamic = "force-dynamic";
export const { GET, PUT, DELETE } = savedDocumentHandlers({
  configured: clerkConfigured,
  userId: authenticatedUserId,
  allowedOrigins: () => process.env.CLERK_AUTHORIZED_PARTIES?.split(",").map(s => s.trim()).filter(Boolean) ?? [],
  list: (clerkUserId) => prisma.savedDocument.findMany({
    where: { clerkUserId }, orderBy: { createdAt: "desc" },
    select: { documentId: true, createdAt: true,
      document: { select: { id: true, title: true, caseName: true, court: true, caseNumber: true } } },
  }),
  exists: async (id) => Boolean(await prisma.document.findUnique({ where: { id }, select: { id: true } })),
  save: async (clerkUserId, documentId) => {
    await prisma.savedDocument.upsert({
      where: { clerkUserId_documentId: { clerkUserId, documentId } },
      create: { clerkUserId, documentId }, update: {},
    });
  },
  remove: async (clerkUserId, documentId) => {
    await prisma.savedDocument.deleteMany({ where: { clerkUserId, documentId } });
  },
});
