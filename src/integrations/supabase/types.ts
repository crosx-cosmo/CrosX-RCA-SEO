export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      link_clicks: {
        Row: {
          browser: string | null;
          clicked_at: string;
          country: string | null;
          device: string | null;
          id: number;
          is_bot: boolean;
          link_id: string;
          os: string | null;
          referrer_host: string | null;
          region: string | null;
          rule_id: string | null;
          utm_campaign: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          visitor_hash: string;
        };
        Insert: {
          browser?: string | null;
          clicked_at?: string;
          country?: string | null;
          device?: string | null;
          id?: number;
          is_bot?: boolean;
          link_id: string;
          os?: string | null;
          referrer_host?: string | null;
          region?: string | null;
          rule_id?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          visitor_hash: string;
        };
        Update: {
          browser?: string | null;
          clicked_at?: string;
          country?: string | null;
          device?: string | null;
          id?: number;
          is_bot?: boolean;
          link_id?: string;
          os?: string | null;
          referrer_host?: string | null;
          region?: string | null;
          rule_id?: string | null;
          utm_campaign?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          visitor_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "link_clicks_link_id_fkey";
            columns: ["link_id"];
            isOneToOne: false;
            referencedRelation: "short_links";
            referencedColumns: ["id"];
          },
        ];
      };
      monitor_checks: {
        Row: {
          changes: string[];
          checked_at: string;
          error: string | null;
          final_url: string | null;
          hops: number | null;
          https: boolean | null;
          id: number;
          loop: boolean | null;
          monitor_id: string;
          ms: number | null;
          state: string;
          status: number | null;
        };
        Insert: {
          changes?: string[];
          checked_at?: string;
          error?: string | null;
          final_url?: string | null;
          hops?: number | null;
          https?: boolean | null;
          id?: number;
          loop?: boolean | null;
          monitor_id: string;
          ms?: number | null;
          state: string;
          status?: number | null;
        };
        Update: {
          changes?: string[];
          checked_at?: string;
          error?: string | null;
          final_url?: string | null;
          hops?: number | null;
          https?: boolean | null;
          id?: number;
          loop?: boolean | null;
          monitor_id?: string;
          ms?: number | null;
          state?: string;
          status?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "monitor_checks_monitor_id_fkey";
            columns: ["monitor_id"];
            isOneToOne: false;
            referencedRelation: "monitors";
            referencedColumns: ["id"];
          },
        ];
      };
      monitors: {
        Row: {
          avg_ms: number | null;
          created_at: string;
          enabled: boolean;
          id: string;
          interval_minutes: number;
          label: string | null;
          last_alert_at: string | null;
          last_alert_key: string | null;
          last_checked_at: string | null;
          last_error: string | null;
          last_final_url: string | null;
          last_hops: number | null;
          last_ms: number | null;
          last_status: number | null;
          next_check_at: string;
          owner_hash: string;
          state: string;
          url: string;
          webhook_url: string | null;
        };
        Insert: {
          avg_ms?: number | null;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          interval_minutes?: number;
          label?: string | null;
          last_alert_at?: string | null;
          last_alert_key?: string | null;
          last_checked_at?: string | null;
          last_error?: string | null;
          last_final_url?: string | null;
          last_hops?: number | null;
          last_ms?: number | null;
          last_status?: number | null;
          next_check_at?: string;
          owner_hash: string;
          state?: string;
          url: string;
          webhook_url?: string | null;
        };
        Update: {
          avg_ms?: number | null;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          interval_minutes?: number;
          label?: string | null;
          last_alert_at?: string | null;
          last_alert_key?: string | null;
          last_checked_at?: string | null;
          last_error?: string | null;
          last_final_url?: string | null;
          last_hops?: number | null;
          last_ms?: number | null;
          last_status?: number | null;
          next_check_at?: string;
          owner_hash?: string;
          state?: string;
          url?: string;
          webhook_url?: string | null;
        };
        Relationships: [];
      };
      redirect_analyses: {
        Row: {
          created_at: string;
          final_status: number | null;
          final_url: string | null;
          id: string;
          issue_count: number;
          redirect_loop: boolean;
          result: Json;
          start_url: string;
          total_hops: number;
          total_redirects: number;
          total_response_time_ms: number;
        };
        Insert: {
          created_at?: string;
          final_status?: number | null;
          final_url?: string | null;
          id?: string;
          issue_count?: number;
          redirect_loop?: boolean;
          result: Json;
          start_url: string;
          total_hops?: number;
          total_redirects?: number;
          total_response_time_ms?: number;
        };
        Update: {
          created_at?: string;
          final_status?: number | null;
          final_url?: string | null;
          id?: string;
          issue_count?: number;
          redirect_loop?: boolean;
          result?: Json;
          start_url?: string;
          total_hops?: number;
          total_redirects?: number;
          total_response_time_ms?: number;
        };
        Relationships: [];
      };
      short_links: {
        Row: {
          clicks: number;
          created_at: string;
          destination: string;
          enabled: boolean;
          expires_at: string | null;
          id: string;
          last_clicked_at: string | null;
          owner_hash: string;
          rules: Json;
          slug: string;
        };
        Insert: {
          clicks?: number;
          created_at?: string;
          destination: string;
          enabled?: boolean;
          expires_at?: string | null;
          id?: string;
          last_clicked_at?: string | null;
          owner_hash: string;
          rules?: Json;
          slug: string;
        };
        Update: {
          clicks?: number;
          created_at?: string;
          destination?: string;
          enabled?: boolean;
          expires_at?: string | null;
          id?: string;
          last_clicked_at?: string | null;
          owner_hash?: string;
          rules?: Json;
          slug?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _sl_hash: { Args: { token: string }; Returns: string };
      create_monitor: {
        Args: {
          p_interval: number;
          p_label: string;
          p_owner: string;
          p_url: string;
          p_webhook: string;
        };
        Returns: string;
      };
      create_short_link: {
        Args: { p_destination: string; p_owner: string; p_slug: string };
        Returns: {
          clicks: number;
          created_at: string;
          destination: string;
          enabled: boolean;
          expires_at: string | null;
          id: string;
          last_clicked_at: string | null;
          owner_hash: string;
          rules: Json;
          slug: string;
        };
        SetofOptions: {
          from: "*";
          to: "short_links";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_monitor: {
        Args: { p_id: string; p_owner: string };
        Returns: boolean;
      };
      delete_short_link: {
        Args: { p_id: string; p_owner: string };
        Returns: boolean;
      };
      export_link_clicks: {
        Args: { p_from: string; p_id: string; p_owner: string; p_to: string };
        Returns: {
          browser: string;
          clicked_at: string;
          country: string;
          device: string;
          is_bot: boolean;
          os: string;
          referrer_host: string;
          region: string;
          rule_id: string;
          utm_campaign: string;
          utm_medium: string;
          utm_source: string;
        }[];
      };
      get_redirect_target: {
        Args: { p_slug: string };
        Returns: {
          destination: string;
          id: string;
          rules: Json;
        }[];
      };
      link_analytics: {
        Args: { p_from: string; p_id: string; p_owner: string; p_to: string };
        Returns: Json;
      };
      list_monitors: {
        Args: { p_owner: string };
        Returns: {
          avg_ms: number;
          created_at: string;
          enabled: boolean;
          has_webhook: boolean;
          id: string;
          interval_minutes: number;
          label: string;
          last_alert_at: string;
          last_checked_at: string;
          last_error: string;
          last_final_url: string;
          last_hops: number;
          last_ms: number;
          last_status: number;
          next_check_at: string;
          state: string;
          url: string;
        }[];
      };
      list_short_links: {
        Args: { p_owner: string };
        Returns: {
          clicks: number;
          created_at: string;
          destination: string;
          enabled: boolean;
          expires_at: string;
          id: string;
          last_clicked_at: string;
          rules: Json;
          slug: string;
        }[];
      };
      monitor_history: {
        Args: { p_id: string; p_owner: string };
        Returns: {
          changes: string[];
          checked_at: string;
          error: string | null;
          final_url: string | null;
          hops: number | null;
          https: boolean | null;
          id: number;
          loop: boolean | null;
          monitor_id: string;
          ms: number | null;
          state: string;
          status: number | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "monitor_checks";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      owns_monitor: {
        Args: { p_id: string; p_owner: string };
        Returns: boolean;
      };
      record_link_click: {
        Args: {
          p_browser: string;
          p_country: string;
          p_device: string;
          p_is_bot: boolean;
          p_link_id: string;
          p_os: string;
          p_referrer: string;
          p_region: string;
          p_rule: string;
          p_utm_campaign: string;
          p_utm_medium: string;
          p_utm_source: string;
          p_visitor: string;
        };
        Returns: undefined;
      };
      resolve_short_link: { Args: { p_slug: string }; Returns: string };
      set_short_link_enabled: {
        Args: { p_enabled: boolean; p_id: string; p_owner: string };
        Returns: boolean;
      };
      set_short_link_expiry: {
        Args: { p_expires_at: string; p_id: string; p_owner: string };
        Returns: boolean;
      };
      set_short_link_rules: {
        Args: { p_id: string; p_owner: string; p_rules: Json };
        Returns: boolean;
      };
      update_monitor: {
        Args: {
          p_enabled: boolean;
          p_id: string;
          p_interval: number;
          p_owner: string;
        };
        Returns: boolean;
      };
      update_short_link_destination: {
        Args: { p_destination: string; p_id: string; p_owner: string };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
