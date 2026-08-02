export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  private: {
    Tables: {
      account_deletions: {
        Row: {
          completed_at: string | null;
          created_at: string;
          deletion_status_token_hmac: string;
          expires_at: string;
          id: string;
          requested_at: string;
          safe_failure_code: string | null;
          status: string;
          updated_at: string;
          user_id: string | null;
          user_id_hmac: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          deletion_status_token_hmac: string;
          expires_at: string;
          id?: string;
          requested_at?: string;
          safe_failure_code?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
          user_id_hmac: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          deletion_status_token_hmac?: string;
          expires_at?: string;
          id?: string;
          requested_at?: string;
          safe_failure_code?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
          user_id_hmac?: string;
        };
        Relationships: [];
      };
      auth_request_limits: {
        Row: {
          created_at: string;
          key_hmac: string;
          request_count: number;
          scope: string;
          updated_at: string;
          window_end: string;
          window_start: string;
        };
        Insert: {
          created_at?: string;
          key_hmac: string;
          request_count?: number;
          scope: string;
          updated_at?: string;
          window_end: string;
          window_start: string;
        };
        Update: {
          created_at?: string;
          key_hmac?: string;
          request_count?: number;
          scope?: string;
          updated_at?: string;
          window_end?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      beta_cohort_state: {
        Row: {
          accepted_count: number;
          created_at: string;
          singleton: boolean;
          updated_at: string;
        };
        Insert: {
          accepted_count?: number;
          created_at?: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Update: {
          accepted_count?: number;
          created_at?: string;
          singleton?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      beta_invitations: {
        Row: {
          accepted_user_id: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          invite_token_hmac: string | null;
          normalized_email_hmac: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          accepted_user_id?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          invite_token_hmac?: string | null;
          normalized_email_hmac: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          accepted_user_id?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          invite_token_hmac?: string | null;
          normalized_email_hmac?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      consume_auth_request_limit: {
        Args: {
          requested_at?: string;
          requested_key_hmac: string;
          requested_limit: number;
          requested_scope: string;
        };
        Returns: {
          allowed: boolean;
          limit_value: number;
          remaining: number;
          reset_at: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          age_confirmed_at: string;
          birth_year: number;
          consented_at: string;
          created_at: string;
          display_name: string | null;
          onboarding_state: string;
          privacy_version: string;
          responsible_use_version: string;
          terms_version: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          age_confirmed_at: string;
          birth_year: number;
          consented_at: string;
          created_at?: string;
          display_name?: string | null;
          onboarding_state?: string;
          privacy_version: string;
          responsible_use_version: string;
          terms_version: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          age_confirmed_at?: string;
          birth_year?: number;
          consented_at?: string;
          created_at?: string;
          display_name?: string | null;
          onboarding_state?: string;
          privacy_version?: string;
          responsible_use_version?: string;
          terms_version?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
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

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  private: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
