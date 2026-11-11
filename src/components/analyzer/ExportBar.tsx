import {
  ClipboardCopy,
  FileCheck2,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  Server,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadFile, toCsv, toJson, toReport, toSeoAuditCsv } from "@/lib/redirect-export";
import { toHar } from "@/lib/redirect-har";
import { generateBatchConsolidatedRules } from "@/lib/redirect-rules-codegen";
import type { RedirectAnalysis } from "@/lib/redirect-types";

export function ExportBar({ results }: { results: RedirectAnalysis[] }) {
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(toReport(results));
      toast.success("Report copied to clipboard");
    } catch {
      toast.error("Clipboard access was blocked");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="subtle" size="sm" onClick={copyReport}>
            <ClipboardCopy className="size-3.5" />
            Copy report
          </Button>
        </TooltipTrigger>
        <TooltipContent>Plain-text summary of the chain</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              downloadFile("crosx-seo-audit.csv", toSeoAuditCsv(results), "text/csv");
              toast.success("SEO Audit CSV exported");
            }}
          >
            <FileCheck2 className="size-3.5 text-brand" />
            SEO Audit CSV
          </Button>
        </TooltipTrigger>
        <TooltipContent>Graded SEO audit spreadsheet (Pass / Warning / Critical)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              downloadFile(
                "consolidated-redirects.htaccess",
                generateBatchConsolidatedRules(results, "apache"),
                "text/plain",
              );
              toast.success("Consolidated .htaccess exported");
            }}
          >
            <Server className="size-3.5 text-brand" />
            .htaccess
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Flattened single-hop 301 .htaccess rules for all analyzed URLs
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              downloadFile("redirect-chain.csv", toCsv(results), "text/csv");
              toast.success("Hop CSV exported");
            }}
          >
            <FileSpreadsheet className="size-3.5" />
            Hop CSV
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download per-hop table as CSV</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              downloadFile("redirect-chain.har", toHar(results), "application/json");
              toast.success("HTTP Archive (.har) exported");
            }}
          >
            <FileCode2 className="size-3.5 text-brand" />
            HAR
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download HTTP Archive (.har) v1.2 waterfall capture</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => {
              downloadFile("redirect-chain.json", toJson(results), "application/json");
              toast.success("JSON exported");
            }}
          >
            <FileJson className="size-3.5" />
            JSON
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download full analysis as JSON</TooltipContent>
      </Tooltip>
    </div>
  );
}
